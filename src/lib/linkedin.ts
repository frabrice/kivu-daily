// A LinkedIn profile link, cleaned up the one way the database accepts:
// "linkedin.com/in/jean-luc/" or "https://rw.linkedin.com/in/jean-luc?x=y"
// -> "https://www.linkedin.com/in/jean-luc". Shown on kivuride.com's team.
// Returns null for an empty value, undefined when it isn't a profile link.
export function linkedinUrl(raw: string): string | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]+)\/?(?:[?#].*)?$/i);
  return m ? `https://www.linkedin.com/in/${m[1]}` : undefined;
}

export const LINKEDIN_HINT = 'Your public profile link, like linkedin.com/in/your-name. It shows next to your name on kivuride.com.';
