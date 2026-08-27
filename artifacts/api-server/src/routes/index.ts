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
import devicesRouter from "./devices";
import documentRequestsRouter from "./document-requests";
import searchRouter from "./search";
import calendarRouter from "./calendar";
import feedbackRouter from "./feedback";
import betaFeedbackRouter from "./beta-feedback";
import timeEntriesRouter from "./time-entries";
import invoicesRouter from "./invoices";
import subscriptionRouter from "./subscription";
import serviceEnquiriesRouter from "./service-enquiries";
import causeListRouter from "./cause-list";
import operatorRouter from "./operator";
import governanceRouter from "./governance";
import draftingRouter from "./drafting";

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
router.use(devicesRouter);
router.use(documentRequestsRouter);
router.use(searchRouter);
router.use(calendarRouter);
router.use(feedbackRouter);
router.use(betaFeedbackRouter);
router.use(timeEntriesRouter);
router.use(invoicesRouter);
router.use(subscriptionRouter);
router.use(serviceEnquiriesRouter);
router.use(causeListRouter);
router.use(draftingRouter);
// Cross-tenant by design and gated on OPERATOR_EMAILS, not on any capability.
router.use(operatorRouter);
router.use(governanceRouter);

export default router;
