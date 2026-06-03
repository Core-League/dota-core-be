import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { HttpError } from '../../errors/http.error';
import type { IHttpClientConnectorService } from '../../types/interfaced/connectors/http-client.connector.interface';

/**
 * Thin Promise-based wrapper over `@nestjs/axios`' `HttpService`. v2 use-cases
 * depend on this connector instead of `HttpService` directly so they never deal
 * with RxJS `Observable`s, and every failure surfaces as a single normalized
 * {@link HttpError}.
 *
 * The `*` methods return the response **body** (the common case); use
 * {@link HttpClientConnectorService.request} when you need status/headers.
 */
@Injectable()
export class HttpClientConnectorService implements IHttpClientConnectorService {
  private readonly logger = new Logger(HttpClientConnectorService.name);

  constructor(private readonly http: HttpService) {}

  get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.send<T>({ ...config, method: 'GET', url });
  }

  delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.send<T>({ ...config, method: 'DELETE', url });
  }

  post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.send<T>({ ...config, method: 'POST', url, data });
  }

  put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.send<T>({ ...config, method: 'PUT', url, data });
  }

  patch<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.send<T>({ ...config, method: 'PATCH', url, data });
  }

  /**
   * Full request escape hatch — returns the whole `AxiosResponse` for callers
   * that need status code or headers. Errors are still normalized.
   */
  async request<T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    const method = (config.method ?? 'GET').toString();
    const url = config.url ?? '';
    try {
      return await firstValueFrom(this.http.request<T>(config));
    } catch (err) {
      const axiosErr = err as {
        response?: { status?: number; data?: unknown };
        message?: string;
        code?: string;
      };
      const status = axiosErr.response?.status;
      const reason =
        status !== undefined
          ? `HTTP ${status}`
          : (axiosErr.code ?? axiosErr.message ?? 'request failed');
      const httpErr = new HttpError(
        `${method.toUpperCase()} ${url} failed — ${reason}`,
        { method, url, status, responseData: axiosErr.response?.data },
        err,
      );
      this.logger.error(httpErr.message);
      throw httpErr;
    }
  }

  private async send<T>(config: AxiosRequestConfig): Promise<T> {
    const { data } = await this.request<T>(config);
    return data;
  }
}
