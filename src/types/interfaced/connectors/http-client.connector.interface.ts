import type { AxiosRequestConfig, AxiosResponse } from 'axios';

export interface IHttpClientConnectorService {
  get<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
  delete<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  patch<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T>;
  request<T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>>;
}
