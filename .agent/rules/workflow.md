# Git & Verification Workflow

Whenever you complete a task or file update:

1. **Verify:** Automatically run `npm run build` or `next lint`. If it fails, fix the errors before proceeding.

2. **Review:** Present a summary of changes to the user.

3. **Commit & Push:** Once the user gives a 'thumb up' or says 'looks good', stage changes and push to GitHub using a Conventional Commit message (e.g., feat:, fix:, style:).
