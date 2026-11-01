// src/controllers/taskController.ts
import { Request, Response } from 'express';
import Task from '../models/taskModel';
import Attachment from '../models/attachmentModel';
import pool from '../config/database';
import cloudinary from '../config/cloudinary';
import streamifier from 'streamifier';
import socketService from '../services/socketService';
import { canAccessTask } from '../utils/authz';

const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];
const MAX_ATTACHMENTS_PER_TASK = 5;

class TaskController {
  // Create a new task (Admin only)
  static async createTask(req: Request, res: Response): Promise<void> {
    try {
      const { title, description, category, dueDate, priority, assignedTo } = req.body;
      const createdBy = req.user.id;

      // Validate required fields
      if (!title || !assignedTo) {
        res.status(400).json({
          success: false,
          error: 'Title and assignedTo are required'
        });
        return;
      }

      // Validate that the employee is on this admin's team
      const teamCheck = await pool.query(
        `SELECT id FROM team_invitations 
         WHERE admin_id = $1 AND employee_id = $2 AND status = 'accepted'`,
        [createdBy, assignedTo]
      );

      if (teamCheck.rows.length === 0) {
        res.status(403).json({
          success: false,
          error: 'You can only assign tasks to employees on your team'
        });
        return;
      }

      // Create task
      const task = await Task.create({
        title,
        description,
        category,
        dueDate,
        priority: priority || 'medium',
        createdBy,
        assignedTo
      });

      // Handle optional file attachments (when sent as multipart/form-data)
      const files = req.files as Express.Multer.File[] | undefined;
      const attachments = [];

      if (files && files.length > 0) {
        // Validate file count
        if (files.length > MAX_ATTACHMENTS_PER_TASK) {
          res.status(400).json({
            success: false,
            error: `Maximum ${MAX_ATTACHMENTS_PER_TASK} attachments allowed per task`
          });
          return;
        }

        // Validate file types
        for (const file of files) {
          if (!ALLOWED_FILE_TYPES.includes(file.mimetype)) {
            res.status(400).json({
              success: false,
              error: `File type not allowed: ${file.originalname}. Accepted: images, PDF, DOCX, XLSX`
            });
            return;
          }
        }

        // Upload each file to Cloudinary and save to DB
        for (const file of files) {
          const uploadResult = await new Promise<{ secure_url: string }>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: 'workwave/task-attachments', resource_type: 'auto' },
              (error, result) => {
                if (error) return reject(error);
                if (result) return resolve(result);
                reject(new Error('No result from Cloudinary'));
              }
            );
            streamifier.createReadStream(file.buffer).pipe(stream);
          });

          const attachment = await Attachment.create(
            task.id,
            createdBy,
            uploadResult.secure_url,
            file.originalname,
            file.mimetype,
            file.size
          );
          attachments.push(attachment);
        }
      }

      const taskDataWithAttachments = { ...task, attachments };

      // Emit socket event to the assigned employee
      socketService.emitTaskAssigned(assignedTo, taskDataWithAttachments as any);

      res.status(201).json({
        success: true,
        data: taskDataWithAttachments
      });
    } catch (error) {
      console.error('Create task error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create task'
      });
    }
  }

  // Get all tasks for current user
  static async getMyTasks(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user.id;
      const tasks = await Task.getByUserId(userId);

      res.json({
        success: true,
        data: tasks
      });
    } catch (error) {
      console.error('Get tasks error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch tasks'
      });
    }
  }

  // Get all tasks (Admin only — scoped to the requesting admin's own tasks)
  static async getAllTasks(req: Request, res: Response): Promise<void> {
    try {
      const adminId = req.user.id;
      const tasks = await Task.getAll(adminId);

      res.json({
        success: true,
        data: tasks
      });
    } catch (error) {
      console.error('Get all tasks error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch tasks'
      });
    }
  }

  // Get tasks grouped by employee (Admin only)
  static async getTasksByEmployee(req: Request, res: Response): Promise<void> {
    try {
      const adminId = req.user.id;
      const groupedTasks = await Task.getGroupedByEmployee(adminId);

      res.json({
        success: true,
        data: groupedTasks
      });
    } catch (error) {
      console.error('Get grouped tasks error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch grouped tasks'
      });
    }
  }

  // Accept task (Employee only)
  static async acceptTask(req: Request, res: Response): Promise<void> {
    try {
      const taskId = req.params.taskId as string;
      const userId = req.user.id;

      const task = await Task.getById(taskId);

      if (!task) {
        res.status(404).json({
          success: false,
          error: 'Task not found'
        });
        return;
      }

      if (task.assigned_to !== userId) {
        res.status(403).json({
          success: false,
          error: 'You can only accept tasks assigned to you'
        });
        return;
      }

      const updatedTask = await Task.updateStatus(taskId, 'active');

      // Notify admin and employee
      socketService.emitTaskStatusChanged(task.created_by, userId, task.id, 'active');

      res.json({
        success: true,
        data: updatedTask
      });
    } catch (error) {
      console.error('Accept task error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to accept task'
      });
    }
  }

  // Complete task (Employee only)
  static async completeTask(req: Request, res: Response): Promise<void> {
    try {
      const taskId = req.params.taskId as string;
      const userId = req.user.id;

      const task = await Task.getById(taskId);

      if (!task) {
        res.status(404).json({
          success: false,
          error: 'Task not found'
        });
        return;
      }

      if (task.assigned_to !== userId) {
        res.status(403).json({
          success: false,
          error: 'You can only complete tasks assigned to you'
        });
        return;
      }

      const updatedTask = await Task.updateStatus(taskId, 'completed');

      // Notify admin and employee
      socketService.emitTaskStatusChanged(task.created_by, userId, task.id, 'completed');

      res.json({
        success: true,
        data: updatedTask
      });
    } catch (error) {
      console.error('Complete task error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to complete task'
      });
    }
  }

  // Fail/Reject task (Employee only)
  static async failTask(req: Request, res: Response): Promise<void> {
    try {
      const taskId = req.params.taskId as string;
      const userId = req.user.id;

      const task = await Task.getById(taskId);

      if (!task) {
        res.status(404).json({
          success: false,
          error: 'Task not found'
        });
        return;
      }

      if (task.assigned_to !== userId) {
        res.status(403).json({
          success: false,
          error: 'You can only reject tasks assigned to you'
        });
        return;
      }

      const updatedTask = await Task.updateStatus(taskId, 'failed');

      // Notify admin and employee
      socketService.emitTaskStatusChanged(task.created_by, userId, task.id, 'failed');

      res.json({
        success: true,
        data: updatedTask
      });
    } catch (error) {
      console.error('Fail task error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reject task'
      });
    }
  }

  // Get task counts for current user
  static async getMyTaskCounts(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user.id;
      const counts = await Task.getTaskCounts(userId);

      res.json({
        success: true,
        data: counts
      });
    } catch (error) {
      console.error('Get task counts error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch task counts'
      });
    }
  }

  // Delete task (Admin only, and only tasks the admin created)
  static async deleteTask(req: Request, res: Response): Promise<void> {
    try {
      const taskId = req.params.taskId as string;
      const userId = req.user.id;

      // Verify the task exists and that this admin created it
      const task = await Task.getById(taskId);
      if (!task) {
        res.status(404).json({
          success: false,
          error: 'Task not found'
        });
        return;
      }
      if (task.created_by !== userId) {
        res.status(403).json({
          success: false,
          error: 'You do not have permission to delete this task'
        });
        return;
      }

      const deletedTask = await Task.delete(taskId);

      if (!deletedTask) {
        res.status(404).json({
          success: false,
          error: 'Task not found'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Task deleted successfully',
        data: deletedTask
      });
    } catch (error) {
      console.error('Delete task error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete task'
      });
    }
  }

  // Upload attachments to an existing task (Admin only)
  static async uploadAttachments(req: Request, res: Response): Promise<void> {
    try {
      const taskId = req.params.taskId as string;
      const userId = req.user.id;

      // Verify task exists and admin created it
      const task = await Task.getById(taskId);
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }
      if (task.created_by !== userId) {
        res.status(403).json({ success: false, error: 'Only the task creator can add attachments' });
        return;
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ success: false, error: 'No files uploaded' });
        return;
      }

      // Check total attachment count won't exceed limit
      const currentCount = await Attachment.countByTaskId(taskId);
      if (currentCount + files.length > MAX_ATTACHMENTS_PER_TASK) {
        res.status(400).json({
          success: false,
          error: `Task already has ${currentCount} attachment(s). Maximum is ${MAX_ATTACHMENTS_PER_TASK}. You can add ${MAX_ATTACHMENTS_PER_TASK - currentCount} more.`
        });
        return;
      }

      // Validate file types
      for (const file of files) {
        if (!ALLOWED_FILE_TYPES.includes(file.mimetype)) {
          res.status(400).json({
            success: false,
            error: `File type not allowed: ${file.originalname}. Accepted: images, PDF, DOCX, XLSX`
          });
          return;
        }
      }

      // Upload each file
      const attachments = [];
      for (const file of files) {
        const uploadResult = await new Promise<{ secure_url: string }>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'workwave/task-attachments', resource_type: 'auto' },
            (error, result) => {
              if (error) return reject(error);
              if (result) return resolve(result);
              reject(new Error('No result from Cloudinary'));
            }
          );
          streamifier.createReadStream(file.buffer).pipe(stream);
        });

        const attachment = await Attachment.create(
          parseInt(taskId),
          userId,
          uploadResult.secure_url,
          file.originalname,
          file.mimetype,
          file.size
        );
        attachments.push(attachment);
      }

      res.status(201).json({
        success: true,
        data: attachments
      });
    } catch (error) {
      console.error('Upload attachments error:', error);
      res.status(500).json({ success: false, error: 'Failed to upload attachments' });
    }
  }

  // Get attachments for a task (Admin or assigned employee)
  static async getAttachments(req: Request, res: Response): Promise<void> {
    try {
      const taskId = req.params.taskId as string;
      const userId = req.user.id;

      // Verify task exists and user has access
      const task = await Task.getById(taskId);
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }

      if (!canAccessTask(task, userId)) {
        res.status(403).json({ success: false, error: 'You do not have access to this task' });
        return;
      }

      const attachments = await Attachment.getByTaskId(taskId);

      res.json({
        success: true,
        data: attachments
      });
    } catch (error) {
      console.error('Get attachments error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch attachments' });
    }
  }

  // Delete an attachment (Admin only, and only on tasks the admin created)
  static async deleteAttachment(req: Request, res: Response): Promise<void> {
    try {
      const taskId = Number(req.params.taskId);
      const attachmentId = Number(req.params.attachmentId);
      const userId = req.user.id;

      if (!Number.isInteger(taskId) || !Number.isInteger(attachmentId)) {
        res.status(400).json({ success: false, error: 'Invalid task or attachment ID' });
        return;
      }

      // The attachment must belong to the task in the URL...
      const attachment = await Attachment.getById(attachmentId);
      if (!attachment || attachment.task_id !== taskId) {
        res.status(404).json({ success: false, error: 'Attachment not found' });
        return;
      }

      // ...and that task must belong to the requesting admin
      const task = await Task.getById(taskId);
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }
      if (task.created_by !== userId) {
        res.status(403).json({ success: false, error: 'Only the task creator can delete attachments' });
        return;
      }

      const deleted = await Attachment.delete(attachmentId);

      if (!deleted) {
        res.status(404).json({ success: false, error: 'Attachment not found' });
        return;
      }

      res.json({
        success: true,
        message: 'Attachment deleted successfully',
        data: deleted
      });
    } catch (error) {
      console.error('Delete attachment error:', error);
      res.status(500).json({ success: false, error: 'Failed to delete attachment' });
    }
  }
}

export default TaskController;
