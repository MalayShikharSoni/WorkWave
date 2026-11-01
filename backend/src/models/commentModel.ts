// src/models/commentModel.ts
import pool from '../config/database';

export interface CommentRow {
  id: number;
  task_id: number;
  author_id: number;
  content: string;
  created_at: string;
  author_name?: string;
  author_avatar?: string;
}

class Comment {
  static async create(taskId: number | string, authorId: number, content: string): Promise<CommentRow> {
    // Insert and return joined with author details
    const result = await pool.query(
      `WITH inserted AS (
         INSERT INTO task_comments (task_id, author_id, content)
         VALUES ($1, $2, $3)
         RETURNING *
       )
       SELECT c.*, u.first_name as author_name, u.avatar_url as author_avatar
       FROM inserted c
       JOIN users u ON c.author_id = u.id`,
      [taskId, authorId, content]
    );
    return result.rows[0];
  }

  static async getByTaskId(taskId: number | string): Promise<CommentRow[]> {
    const result = await pool.query(
      `SELECT c.*, u.first_name as author_name, u.avatar_url as author_avatar
       FROM task_comments c
       JOIN users u ON c.author_id = u.id
       WHERE c.task_id = $1
       ORDER BY c.created_at ASC`,
      [taskId]
    );
    return result.rows;
  }

  static async getById(commentId: number | string): Promise<CommentRow | undefined> {
    const result = await pool.query(
      `SELECT * FROM task_comments WHERE id = $1`,
      [commentId]
    );
    return result.rows[0];
  }

  static async delete(commentId: number | string, taskId: number | string, authorId: number): Promise<CommentRow | undefined> {
    const result = await pool.query(
      `DELETE FROM task_comments WHERE id = $1 AND task_id = $2 AND author_id = $3 RETURNING *`,
      [commentId, taskId, authorId]
    );
    return result.rows[0];
  }
}

export default Comment;
