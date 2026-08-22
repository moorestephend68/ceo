/* Which build is actually running.

   Three separate sessions were spent guessing whether a change had reached the
   live site — comparing file hashes against GitHub, reading deploy logs, probing
   routes for fields that only exist in newer code. All of it was archaeology in
   place of a label.

   So: a label. It appears in /api/config and at the bottom of the page, and the
   question "is my change live?" becomes something anyone can answer in one look.

   Bump it when you ship. It is not derived from git on purpose — the site is
   deployed by uploading files, and a marker that depends on a build step nobody
   runs is a marker that lies. */

export const BUILD = '2026-08-22 · tournaments';
