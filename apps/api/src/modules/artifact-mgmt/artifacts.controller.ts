import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Res, StreamableFile } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { ArtifactsService } from "./artifacts.service";

type HeaderResponse = {
  set(headers: Record<string, string>): void;
};

@Controller()
export class ArtifactsController {
  constructor(
    @Inject(ArtifactsService) private readonly artifacts: ArtifactsService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get("artifacts")
  async listArtifacts(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.artifacts.listArtifacts(query, principal);
  }

  @Post("artifacts")
  async createArtifact(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.artifacts.createArtifact(body, principal);
  }

  @Get("files")
  async listFiles(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.artifacts.listFiles(query, principal);
  }

  @Post("files")
  async createFile(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.artifacts.createFile(body, principal);
  }

  @Post("files/:fileObjectId/download-grants")
  async createDownloadGrant(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("fileObjectId") fileObjectId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.artifacts.createDownloadGrant(fileObjectId, body, principal);
  }

  @Get("files/:fileObjectId/download")
  async downloadFile(
    @Param("fileObjectId") fileObjectId: string,
    @Query("token") token: string | undefined,
    @Res({ passthrough: true }) response: HeaderResponse
  ) {
    const download = await this.artifacts.downloadFile(fileObjectId, token);
    response.set({
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${download.file.fileName.replace(/["\\\r\n]/g, "_")}"`,
      "content-length": String(download.bytes.byteLength),
      "content-type": download.file.contentType
    });
    return new StreamableFile(download.bytes);
  }
}
