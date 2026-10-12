import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { DeliveryHandoffModule } from "../delivery-handoff/delivery-handoff.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ResourceControlsModule } from "../resource-controls/resource-controls.module";
import { AlertsController } from "./alerts.controller";
import { AlertsService } from "./alerts.service";

@Module({
  // DeliveryHandoffModule: the scan recomputes each project's status proposal (V-17). It imports nothing from this module.
  imports: [PrismaModule, IdentityAccessModule, ResourceControlsModule, NotificationsModule, DeliveryHandoffModule],
  controllers: [AlertsController],
  providers: [AlertsService]
})
export class AlertsModule {}
