// Sign-in problems the server can report, in the words shown on the form. The decision itself (valid role, valid branch, branch picked on the form matching the assigned
// one, at least one module) is made by the server in POST /auth/login; the browser only displays the answer.
export const LOGIN_PROBLEMS = {
  unassigned: 'Your account is not fully set up (role, branch or module access is missing). Please contact your Super Admin.',
  'branch-inactive': 'Your branch is currently inactive. Please contact your Super Admin.',
  'branch-mismatch': 'The selected branch does not match the branch assigned to your account. Select your assigned branch and try again.',
  'branch-required': 'Select your branch to sign in.',
}
