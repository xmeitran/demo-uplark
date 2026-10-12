import { Module } from "@nestjs/common";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { DeliveryHandoffModule } from "../delivery-handoff/delivery-handoff.module";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { FrameworkConversionAdminService } from "./framework-conversion-admin.service";
import { FrameworkConversionController } from "./framework-conversion.controller";

@Module({
  imports: [PrismaModule, IdentityAccessModule, DeliveryHandoffModule],
  controllers: [FrameworkConversionController],
  providers: [FrameworkConversionAdminService]
})
export class FrameworkConversionModule {}
