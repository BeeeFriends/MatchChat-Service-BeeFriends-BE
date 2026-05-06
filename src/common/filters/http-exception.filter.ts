import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;
    const { message, errors } = this.normalizeException(
      exception,
      exceptionResponse,
    );

    response.status(status).json({
      success: false,
      message,
      ...(errors ? { errors } : {}),
    });
  }

  private normalizeException(exception: unknown, exceptionResponse: unknown) {
    if (this.isRecord(exceptionResponse)) {
      const responseMessage = exceptionResponse.message;

      if (Array.isArray(responseMessage)) {
        return {
          message: 'Validasi gagal',
          errors: responseMessage.map((message) => ({
            message: String(message),
          })),
        };
      }

      if (typeof responseMessage === 'string') {
        return { message: responseMessage };
      }
    }

    if (typeof exceptionResponse === 'string') {
      return { message: exceptionResponse };
    }

    if (exception instanceof Error && exception.message) {
      return { message: exception.message };
    }

    return { message: 'Internal server error' };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
