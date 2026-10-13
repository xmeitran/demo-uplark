import { ArgumentsHost, Catch, ExceptionFilter, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const FIELD_LABELS: Record<string, string> = {
  code: "Mã",
  email: "Email",
  name: "Tên",
  key: "Mã khóa",
  employeeCode: "Mã nhân sự",
  employee_code: "Mã nhân sự"
};

/** Columns of the violated unique constraint that a person can change (scope columns such as workspaceId are left out). */
function uniqueFields(target: unknown): string[] {
  const columns = Array.isArray(target) ? target.map(String) : typeof target === "string" ? target.split(/[_,\s]+/) : [];
  return columns.filter((column) => column in FIELD_LABELS);
}

/**
 * What a database error that no service handled becomes for the user. A unique collision or a row that is gone is the
 * user's to fix, so it gets a 409 / 404 and a sentence; anything else stays a 500.
 */
export function prismaErrorResponse(error: { code?: string; meta?: Record<string, unknown> | null }): { statusCode: number; message: string } {
  if (error.code === "P2002") {
    const fields = uniqueFields(error.meta?.target).map((column) => FIELD_LABELS[column]);
    return {
      statusCode: 409,
      message: fields.length
        ? `${fields.join(", ")} đã được dùng cho một bản ghi khác. Hãy nhập giá trị khác rồi lưu lại.`
        : "Bản ghi này bị trùng với một bản ghi đã có. Hãy kiểm tra lại mã hoặc tên rồi lưu lại."
    };
  }
  if (error.code === "P2025") {
    return { statusCode: 404, message: "Không tìm thấy bản ghi cần lưu, có thể đã bị xóa hoặc thay đổi ở nơi khác. Hãy tải lại trang rồi thử lại." };
  }
  return { statusCode: 500, message: "Internal server error" };
}

/** Registered once in main.ts: Prisma errors that reach the HTTP layer answer with prismaErrorResponse. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const body = prismaErrorResponse(exception);
    if (body.statusCode >= 500) this.logger.error(exception.message, exception.stack);
    host.switchToHttp().getResponse().status(body.statusCode).json(body);
  }
}
