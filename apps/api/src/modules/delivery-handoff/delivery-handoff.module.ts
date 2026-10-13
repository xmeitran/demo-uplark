import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ResourceControlsModule } from "../resource-controls/resource-controls.module";
import { BaselineController } from "./baseline.controller";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectPermissionsService } from "./project-permissions.service";
import { TimeEntriesService } from "./time-entries.service";
import { MilestoneGatesService } from "./milestone-gates.service";
import { TaskClassificationService } from "./task-classification.service";
import { ProjectTemplatesService } from "./project-templates.service";

@Module({
  // ResourceControlsModule: the cost-period lock (D-28). It imports nothing from this module, so there is no cycle.
  imports: [PrismaModule, IdentityAccessModule, NotificationsModule, ResourceControlsModule],
  controllers: [ProjectsController, BaselineController],
  providers: [ProjectsService, ProjectPermissionsService, TimeEntriesService, MilestoneGatesService, TaskClassificationService, ProjectTemplatesService],
  exports: [ProjectsService, ProjectPermissionsService, TimeEntriesService, MilestoneGatesService, TaskClassificationService, ProjectTemplatesService],
})
export class DeliveryHandoffModule {}
