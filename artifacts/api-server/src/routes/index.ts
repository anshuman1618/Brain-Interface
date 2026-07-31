import { Router, type IRouter } from "express";
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

const router: IRouter = Router();

// healthRouter is mounted directly on the app, ahead of auth — see app.ts.
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

export default router;
