// Returns the URL only if it is a plain https link; otherwise null.
// Use for any user-supplied URL rendered as an href, so values like
// "javascript:..." can never become a clickable link.
export const safeHttpsUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};
