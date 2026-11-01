// src/controllers/commentController.ts
import { Request, Response } from 'express';
import Comment from '../models/commentModel';
import Task from '../models/taskModel';
import socketService from '../services/socketService';
import { canAccessTask } from '../utils/authz';

class CommentController {
  static async getComments(req: Request, res: Response): Promise<void> {
    try {
      const taskId = req.params.taskId as string;
      const userId = req.user.id;
      
      // Basic access check: task must exist
      const task = await Task.getById(taskId);
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }
      
      // Only the task's creator (admin) and assignee (employee) may see its thread
      if (!canAccessTask(task, userId)) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      const comments = await Comment.getByTaskId(taskId);
      res.json({ success: true, data: comments });
    } catch (error) {
      console.error('Get comments error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch comments' });
    }
  }

  static async createComment(req: Request, res: Response): Promise<void> {
    try {
      const taskId = req.params.taskId as string;
      const { content } = req.body;
      const userId = req.user.id;

      if (!content || !content.trim()) {
        res.status(400).json({ success: false, error: 'Comment content is required' });
        return;
      }

      const task = await Task.getById(taskId);
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }

      if (!canAccessTask(task, userId)) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      const newComment = await Comment.create(taskId, userId, content.trim());

      // Socket Emission
      socketService.getIO().to(`user:${task.created_by}`).emit('comment:new', newComment);
      socketService.getIO().to(`user:${task.assigned_to}`).emit('comment:new', newComment);

      // Persist generic notification for the *other* person
      const recipientId = userId === task.created_by ? task.assigned_to : task.created_by;
      socketService.createAndEmitNotification(
        recipientId,
        'comment_new',
        'New Task Comment',
        `A new comment was added to "${task.title}"`,
        String(taskId),
        'task'
      );

      res.status(201).json({ success: true, data: newComment });
    } catch (error) {
      console.error('Create comment error:', error);
      res.status(500).json({ success: false, error: 'Failed to create comment' });
    }
  }

  static async deleteComment(req: Request, res: Response): Promise<void> {
    try {
      const taskId = req.params.taskId as string;
      const commentId = req.params.commentId as string;
      const userId = req.user.id;

      // Scoped to author AND task, so a comment can't be removed via an unrelated task URL
      const deleted = await Comment.delete(commentId, taskId, userId);
      if (!deleted) {
        res.status(403).json({ success: false, error: 'Comment not found or access denied' });
        return;
      }

      res.json({ success: true, data: deleted });
    } catch (error) {
      console.error('Delete comment error:', error);
      res.status(500).json({ success: false, error: 'Failed to delete comment' });
    }
  }
}

export default CommentController;
