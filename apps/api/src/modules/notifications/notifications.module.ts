import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [PrismaModule, IdentityAccessModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService]
})
export class NotificationsModule {}
