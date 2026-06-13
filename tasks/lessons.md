# Lessons

- When asked to host guides in the website, make each guide a real page/route.
  Do not embed multiple full markdown documents inside one long docs index page.
- Public header controls should stay compact. Put secondary display preferences
  like theme selection behind an icon menu instead of a full segmented control.
- Hosted docs should use human link labels for guide pages and preserve wrapped
  list content inside the same bullet; do not expose source filenames as UI copy.
- Team folder clicks should match personal folder behavior: open the folder
  management/listing route, not the preview iframe route.
- Private repository integrations must be user-scoped by default. Do not use a
  single server-wide credential when each user needs access to their own private
  repositories.
- GitHub import UX should prefer repositories accessible to the current user's
  token, then offer a manual URL fallback. Do not force URL-first flows for
  private repository imports.
