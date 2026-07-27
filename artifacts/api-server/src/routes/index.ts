import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import casesRouter from "./cases";
import documentsRouter from "./documents";
import tasksRouter from "./tasks";
import consultationsRouter from "./consultations";
import kpiRouter from "./kpi";
import invitesRouter from "./invites";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(casesRouter);
router.use(documentsRouter);
router.use(tasksRouter);
router.use(consultationsRouter);
router.use(kpiRouter);
router.use(invitesRouter);

export default router;
