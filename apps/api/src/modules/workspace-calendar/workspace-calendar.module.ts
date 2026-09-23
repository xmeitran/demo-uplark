import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { WorkspaceCalendarController } from "./workspace-calendar.controller";
import { WorkspaceCalendarService } from "./workspace-calendar.service";

@Module({
  imports: [PrismaModule, IdentityAccessModule],
  controllers: [WorkspaceCalendarController],
  providers: [WorkspaceCalendarService],
  exports: [WorkspaceCalendarService]
})
export class WorkspaceCalendarModule {}
