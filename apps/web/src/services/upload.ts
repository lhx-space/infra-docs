import {http} from '@/network';

export interface UploadImageResult {
  url: string;
}

/**
 * 通用图片上传（当前唯一消费方是 Wiki 封面图，但接口设计不绑定 Wiki，见 design.md 决策 3）。
 * 用 FormData 提交，字段名 `file` 跟后端 multer 的 `.single('file')` 对应。
 */
export function uploadImage(file: File): Promise<UploadImageResult> {
  const formData = new FormData();
  formData.append('file', file);
  return http.post<UploadImageResult>('/uploads/images', formData);
}
