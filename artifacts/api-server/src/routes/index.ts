import { Router, type IRouter } from "express";
import sessionRouter from "./session";
import usersRouter from "./users";
import casesRouter from "./cases";
import documentsRouter from "./documents";
import tasksRouter from "./tasks";
import consultationsRouter from "./consultations";
import kpiRouter from "./kpi";
import invitesRouter from "./invites";
import notificationsRouter from "./notifications";
import documentRequestsRouter from "./document-requests";
import searchRouter from "./search";
import calendarRouter from "./calendar";
import feedbackRouter from "./feedback";
import subscriptionRouter from "./subscription";

const router: IRouter = Router();

// healthRouter is mounted directly on the app, ahead of auth — see app.ts.
// sessionRouter first: it owns /session and /workspaces, the only endpoints a
// user with no active membership is allowed to reach.
router.use(sessionRouter);
router.use(usersRouter);
router.use(casesRouter);
router.use(documentsRouter);
router.use(tasksRouter);
router.use(consultationsRouter);
router.use(kpiRouter);
router.use(invitesRouter);
router.use(notificationsRouter);
router.use(documentRequestsRouter);
router.use(searchRouter);
router.use(calendarRouter);
router.use(feedbackRouter);
router.use(subscriptionRouter);

export default router;
