/** HTTP 请求方法，供 network 层内部（client/retry）共享，不对外暴露具体实现细节 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
