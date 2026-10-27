/**
 * How a person is drawn in a circle: their Profile picture, or their initials
 * when they have none. A picture keeps the initials too, for when its file
 * cannot be loaded.
 */
export type AvatarFace =
  | { kind: "photo"; src: string; initials: string }
  | { kind: "initials"; initials: string };

/** The first letters of the first and last names, or of the email when there is no name yet. */
export function initialsOf(name: string, email = ""): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0]?.[0] ?? email.trim()[0] ?? "");
  return letters.toUpperCase();
}

export function avatarFace(person: { name: string; email?: string; photoUrl?: string | null }): AvatarFace {
  const initials = initialsOf(person.name, person.email);
  return person.photoUrl ? { kind: "photo", src: person.photoUrl, initials } : { kind: "initials", initials };
}
