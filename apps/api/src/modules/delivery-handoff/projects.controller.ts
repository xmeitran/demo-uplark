import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { ProjectsService } from "./projects.service";

@Controller()
export class ProjectsController {
  constructor(
    @Inject(ProjectsService)
    private readonly projects: ProjectsService,
    @Inject(PrincipalService)
    private readonly principals: PrincipalService
  ) {}

  @Get("projects")
  async listProjects(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listProjects(query, principal);
  }

  @Post("projects")
  async createProject(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any, @Headers("idempotency-key") idempotencyKey?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createProject(body, principal, idempotencyKey);
  }

  @Get("projects/:projectId/members")
  async listProjectMembers(@Headers("authorization") authorization: string | undefined, @Param("projectId") projectId: string, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listProjectMembers(projectId, query, principal);
  }

  @Get("projects/:projectId")
  async getProject(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("projectId") projectId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.getProject(projectId, principal);
  }

  @Patch("projects/:projectId")
  async updateProject(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.updateProject(projectId, body, principal);
  }

  @Delete("projects/:projectId")
  async deleteProject(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("projectId") projectId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.deleteProject(projectId, principal);
  }

  @Get("projects/:projectId/stages")
  async listStages(@Headers("authorization") authorization: string | undefined, @Param("projectId") projectId: string, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listStages(projectId, query, principal);
  }

  @Get("projects/:projectId/hierarchy")
  async getProjectHierarchy(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.getProjectHierarchy(projectId, principal);
  }

  @Put("projects/:projectId/hierarchy/order")
  async reorderProjectHierarchy(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.reorderProjectHierarchy(projectId, body, principal);
  }

  @Post("projects/:projectId/stages")
  async createStage(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createStage(projectId, body, principal);
  }

  @Patch("projects/:projectId/stages/:stageId")
  async updateStage(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Query("scope") scope: string | undefined,
    @Param("projectId") projectId: string,
    @Param("stageId") stageId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.updateStage(projectId, stageId, body, principal, { scope });
  }

  @Delete("projects/:projectId/stages/:stageId")
  async deleteStage(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Query("scope") scope: string | undefined,
    @Param("projectId") projectId: string,
    @Param("stageId") stageId: string
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.deleteStage(projectId, stageId, principal, { scope });
  }

  @Get("projects/:projectId/documents")
  async listProjectDocuments(@Headers("authorization") authorization: string | undefined, @Param("projectId") projectId: string, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listProjectDocuments(projectId, query, principal);
  }

  @Post("projects/:projectId/documents")
  async createProjectDocument(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createProjectDocument(projectId, body, principal);
  }

  @Patch("projects/:projectId/documents/:documentId")
  async updateProjectDocument(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.updateProjectDocument(projectId, documentId, body, principal);
  }

  @Post("projects/:projectId/documents/:documentId/versions")
  async createProjectDocumentVersion(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createProjectDocumentVersion(projectId, documentId, body, principal);
  }

  @Delete("projects/:projectId/documents/:documentId")
  async deleteProjectDocument(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.deleteProjectDocument(projectId, documentId, principal);
  }

  @Get("projects/:projectId/activity")
  async listProjectActivities(@Headers("authorization") authorization: string | undefined, @Param("projectId") projectId: string, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listProjectActivities(projectId, query, principal);
  }

  @Post("projects/:projectId/activity")
  async createProjectActivity(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createProjectActivity(projectId, body, principal, principal.subjectId);
  }

  @Patch("projects/:projectId/activity/:activityId")
  async updateProjectActivity(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Param("activityId") activityId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.updateProjectActivity(projectId, activityId, body, principal);
  }

  @Delete("projects/:projectId/activity/:activityId")
  async deleteProjectActivity(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Param("activityId") activityId: string
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.deleteProjectActivity(projectId, activityId, principal);
  }

  @Get("projects/:projectId/risks")
  async listProjectRisks(@Headers("authorization") authorization: string | undefined, @Param("projectId") projectId: string, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listProjectRisks(projectId, query, principal);
  }

  @Post("projects/:projectId/risks")
  async createProjectRisk(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createProjectRisk(projectId, body, principal, principal.subjectId);
  }

  @Patch("projects/:projectId/risks/:riskId")
  async updateProjectRisk(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Param("riskId") riskId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.updateProjectRisk(projectId, riskId, body, principal);
  }

  @Delete("projects/:projectId/risks/:riskId")
  async deleteProjectRisk(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("projectId") projectId: string,
    @Param("riskId") riskId: string
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.deleteProjectRisk(projectId, riskId, principal);
  }

  @Get("tasks")
  async listTasks(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listTasks(query, principal);
  }

  @Post("tasks")
  async createTask(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createTask(body, principal, principal.subjectId);
  }

  @Get("tasks/planning-blocks")
  async listTaskPlanningBlocks(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listTaskPlanningBlocks(query, principal);
  }

  @Get("tasks/time-entries")
  async listTaskTimeEntries(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listTaskTimeEntries(query, principal);
  }

  @Delete("tasks/planning-blocks/:blockId")
  async deleteTaskPlanningBlock(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("blockId") blockId: string
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.deleteTaskPlanningBlock(blockId, principal);
  }

  @Post("tasks/planning-blocks/:blockId/transitions")
  async transitionTaskPlanningBlock(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("blockId") blockId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.transitionTaskPlanningBlock(blockId, body, principal, principal.subjectId);
  }

  @Delete("tasks/time-entries/:entryId")
  async deleteTaskTimeEntry(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("entryId") entryId: string
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.deleteTaskTimeEntry(entryId, principal);
  }

  @Patch("tasks/time-entries/:entryId")
  async reviewTaskTimeEntry(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("entryId") entryId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.reviewTaskTimeEntry(entryId, body, principal);
  }

  @Get("tasks/:taskId/assignment-history")
  async assignmentHistory(@Headers("authorization") authorization: string | undefined, @Param("taskId") taskId: string, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listTaskAssignmentHistory(taskId, query, principal);
  }

  @Get("tasks/:taskId")
  async getTask(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("taskId") taskId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.getTask(taskId, principal);
  }

  @Patch("tasks/:taskId")
  async updateTask(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("taskId") taskId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.updateTask(taskId, body, principal, principal.subjectId);
  }

  @Delete("tasks/:taskId")
  async deleteTask(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("taskId") taskId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.deleteTask(taskId, principal);
  }

  @Post("tasks/:taskId/transitions")
  async transitionTask(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("taskId") taskId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.transitionTask(taskId, body, principal, principal.subjectId);
  }

  @Post("tasks/:taskId/time-entries")
  async createTimeEntry(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("taskId") taskId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createTimeEntry(taskId, body, principal, principal.subjectId);
  }

  @Post("tasks/:taskId/planning-blocks")
  async createTaskPlanningBlock(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("taskId") taskId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createTaskPlanningBlock(taskId, body, principal, principal.subjectId);
  }

  @Get("tasks/:taskId/comments")
  async listTaskComments(@Headers("authorization") authorization: string | undefined, @Param("taskId") taskId: string, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listTaskComments(taskId, query, principal);
  }

  @Post("tasks/:taskId/comments")
  async createTaskComment(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("taskId") taskId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createTaskComment(taskId, body, principal, principal.subjectId);
  }

  @Get("tasks/:taskId/attachments")
  async listTaskAttachments(@Headers("authorization") authorization: string | undefined, @Param("taskId") taskId: string, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.projects.listTaskAttachments(taskId, query, principal);
  }

  @Post("tasks/:taskId/attachments")
  async createTaskAttachment(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("taskId") taskId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.createTaskAttachment(taskId, body, principal, principal.subjectId);
  }

  @Delete("tasks/:taskId/attachments/:attachmentId")
  async deleteTaskAttachment(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("taskId") taskId: string,
    @Param("attachmentId") attachmentId: string
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.projects.deleteTaskAttachment(taskId, attachmentId, principal);
  }
}
