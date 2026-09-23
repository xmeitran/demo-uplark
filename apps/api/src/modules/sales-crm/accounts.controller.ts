import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { AccountsService } from "./accounts.service";

@Controller("accounts")
export class AccountsController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get()
  async listAccounts(@Headers("authorization") authorization: string | undefined, @Query() query: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, query.principal);
    return this.accounts.listAccounts(query, principal);
  }

  @Post()
  async createAccount(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.accounts.createAccount(body, principal);
  }

  @Get(":accountId")
  async getAccount(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("accountId") accountId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.accounts.getAccount(accountId, principal);
  }

  @Patch(":accountId")
  async updateAccount(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("accountId") accountId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.accounts.updateAccount(accountId, body, principal);
  }

  @Delete(":accountId")
  async deleteAccount(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("accountId") accountId: string
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.accounts.deleteAccount(accountId, principal);
  }

  @Get(":accountId/contacts")
  async listContacts(@Headers("authorization") authorization: string | undefined, @Param("accountId") accountId: string, @Query() query: any, @Headers("x-principal") principalHeader?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalHeader ?? query.principal);
    return this.accounts.listContacts(accountId, query, principal);
  }

  @Post(":accountId/contacts")
  async createContact(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("accountId") accountId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.accounts.createContact(accountId, body, principal);
  }

  @Patch(":accountId/contacts/:contactId")
  async updateContact(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("accountId") accountId: string,
    @Param("contactId") contactId: string,
    @Body() body: any
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.accounts.updateContact(accountId, contactId, body, principal);
  }

  @Delete(":accountId/contacts/:contactId")
  async deleteContact(
    @Headers("authorization") authorization: string | undefined,
    @Query("principal") principalFallback: string | undefined,
    @Param("accountId") accountId: string,
    @Param("contactId") contactId: string
  ) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.accounts.deleteContact(accountId, contactId, principal);
  }
}
