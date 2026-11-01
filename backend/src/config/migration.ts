// src/config/migration.ts
import pool from './database';

async function migrate(): Promise<void> {
  try {
    console.log('Running migration: Creating team_invitations table...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_invitations (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES users(id),
        employee_id INTEGER NOT NULL REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        responded_at TIMESTAMP,
        UNIQUE(admin_id, employee_id)
      );
    `);

    console.log('team_invitations table created successfully');

    console.log('Running migration: Adding priority and is_overdue to tasks...');
    await pool.query(`
      ALTER TABLE tasks 
      ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium',
      ADD COLUMN IF NOT EXISTS is_overdue BOOLEAN DEFAULT false;
    `);
    console.log('tasks table updated successfully');

    console.log('Running migration: Adding profile fields to users...');
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS bio TEXT,
      ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
      ADD COLUMN IF NOT EXISTS designation VARCHAR(100),
      ADD COLUMN IF NOT EXISTS department VARCHAR(100),
      ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(255),
      ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255);
    `);
    console.log('users table updated successfully');

    console.log('Running migration: Creating task_attachments table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_attachments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        uploaded_by INTEGER NOT NULL REFERENCES users(id),
        file_url VARCHAR(500) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        file_size INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id);
    `);
    console.log('task_attachments table created successfully');

    console.log('Running migration: Creating notifications table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        entity_id VARCHAR(50),
        entity_type VARCHAR(50),
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(user_id, is_read);
    `);
    console.log('notifications table created successfully');

    console.log('Running migration: Creating task_comments table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
    `);
    console.log('task_comments table created successfully');

    console.log('Running migration: Creating eom_records table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS eom_records (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES users(id),
        employee_id INTEGER NOT NULL REFERENCES users(id),
        month DATE NOT NULL,
        score INTEGER NOT NULL,
        snapshot_stats JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(admin_id, month)
      );
    `);
    console.log('eom_records table created successfully');

    console.log('Running migration: Creating project_groups table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_groups (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        admin_id INTEGER NOT NULL REFERENCES users(id),
        github_repo_url VARCHAR(500),
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('project_groups table created successfully');

    console.log('Running migration: Creating project_group_members table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_group_members (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES users(id),
        role_in_group VARCHAR(100),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, employee_id)
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pgm_group_id ON project_group_members(group_id);
    `);
    console.log('project_group_members table created successfully');

    console.log('Running migration: Creating project_tasks table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_tasks (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
        assigned_to INTEGER NOT NULL REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'new',
        due_date TIMESTAMP,
        is_overdue BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_project_tasks_group_id ON project_tasks(group_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_project_tasks_assigned_to ON project_tasks(assigned_to);
    `);
    console.log('project_tasks table created successfully');

    console.log('Running migration: Ensuring refresh_tokens table + rotation columns...');
    // Guard: refresh_tokens has historically had no committed DDL. Create it if
    // missing so this migration is self-sufficient on a fresh database.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Rotation + reuse-detection columns.
    await pool.query(`
      ALTER TABLE refresh_tokens
      ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS replaced_by INTEGER REFERENCES refresh_tokens(id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    `);
    console.log('refresh_tokens table ensured/updated successfully');

    console.log('Running migration: Soft-revoking legacy raw (unhashed) refresh tokens...');
    // Refresh tokens are now stored as SHA-256 hex digests. Any pre-existing row
    // still holding a raw JWT (which contains '.' separators: header.payload.
    // signature) is a plaintext bearer credential and must be invalidated. A
    // 64-char [a-f0-9] SHA-256 digest never contains '.', so this pattern targets
    // ONLY legacy raw-token rows. We soft-revoke (set revoked_at) rather than
    // delete, keeping the row for reuse-detection/audit history (per S6).
    // Idempotent: after this runs, no row matches token LIKE '%.%' anymore (all
    // future tokens are hashes), so re-running this migration is a safe no-op.
    const revokedLegacy = await pool.query(`
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE token LIKE '%.%' AND revoked_at IS NULL;
    `);
    console.log(`Soft-revoked ${revokedLegacy.rowCount ?? 0} legacy raw refresh token(s).`);

    console.log('Running migration: Clearing unsafe linkedin_url values...');
    // Profile links are rendered as <a href>. Anything that isn't an https
    // LinkedIn URL (e.g. a stored javascript: URL) is cleared. The API now
    // rejects such values, so this only affects data saved before that check.
    // Idempotent: safe to re-run.
    const clearedLinks = await pool.query(`
      UPDATE users
      SET linkedin_url = NULL
      WHERE linkedin_url IS NOT NULL
        AND linkedin_url <> ''
        AND linkedin_url !~* '^https://([a-z0-9-]+\\.)*linkedin\\.com(/|$)';
    `);
    console.log(`Cleared ${clearedLinks.rowCount ?? 0} unsafe linkedin_url value(s).`);

    console.log('All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    const err = error as Error;
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
