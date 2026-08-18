/**
 * Declares bar enrolment for a test identity.
 *
 * admin, senior_advocate and junior_advocate are all blocked from every
 * workspace-scoped endpoint (requireWorkspace refuses with 403
 * profile_incomplete) until this is called — see DECISIONS.md. Every suite
 * that founds a chamber or invites one of those three roles has to call this
 * for that identity before it does anything else with it.
 *
 * `call` is the suite's own request helper; this only needs it to know how to
 * reach the API, so no suite has to duplicate the fetch plumbing.
 */
export async function declareBarRegistration(call, token) {
  return call("/users/me/bar-registration", {
    token,
    method: "PUT",
    body: { barCouncilState: "Bar Council of Delhi", barEnrolmentNo: "D/0000/2020" },
  });
}
