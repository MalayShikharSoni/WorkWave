// src/utils/profileValidation.ts
// Validation for PUT /api/auth/profile. Limits match the column sizes in
// migration.ts so bad input gets a 400 instead of a database error.

export interface ProfileInput {
  first_name?: string;
  bio?: string;
  phone?: string;
  designation?: string;
  department?: string;
  linkedin_url?: string;
}

const MAX_LENGTHS: Record<keyof ProfileInput, number> = {
  first_name: 100,
  bio: 1000,
  phone: 20,
  designation: 100,
  department: 100,
  linkedin_url: 255,
};

const FIELD_LABELS: Record<keyof ProfileInput, string> = {
  first_name: 'First name',
  bio: 'Bio',
  phone: 'Phone number',
  designation: 'Designation',
  department: 'Department',
  linkedin_url: 'LinkedIn URL',
};

// Only real https LinkedIn links are allowed. This blocks javascript:, data:
// and other schemes that would run code when rendered as a link.
export function isValidLinkedInUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (host === 'linkedin.com' || host.endsWith('.linkedin.com'));
}

export function validateProfileInput(
  body: Record<string, unknown>
): { data: ProfileInput; error?: undefined } | { data?: undefined; error: string } {
  const data: ProfileInput = {};

  for (const field of Object.keys(MAX_LENGTHS) as (keyof ProfileInput)[]) {
    const raw = body[field];
    if (raw === undefined || raw === null) continue;

    if (typeof raw !== 'string') {
      return { error: `${FIELD_LABELS[field]} must be text` };
    }

    const value = raw.trim();
    if (value.length > MAX_LENGTHS[field]) {
      return { error: `${FIELD_LABELS[field]} must be at most ${MAX_LENGTHS[field]} characters` };
    }
    data[field] = value;
  }

  if (data.first_name !== undefined && data.first_name.length === 0) {
    return { error: 'First name cannot be empty' };
  }

  // Empty string clears the link; anything else must be an https LinkedIn URL
  if (data.linkedin_url && !isValidLinkedInUrl(data.linkedin_url)) {
    return { error: 'LinkedIn URL must be an https://linkedin.com/... link' };
  }

  return { data };
}
