## 1. 数据模型

- [x] 1.1 新增 Prisma model `UploadedObject`（`sha256` 唯一、`url` 唯一、`bucket`、`objectKey`、`size`、`mimeType`、`refCount` 默认 1、`createdAt`/`updatedAt`）+ 迁移
- [x] 1.2 `apps/api/src/models/uploaded-object.ts`：新增按 `sha256` 查找、按 `url` 查找、创建记录、原子自增/自减 `refCount` 的数据访问函数

## 2. 上传去重

- [x] 2.1 `services/storage.ts` 的 `uploadImage`：上传前对原始 buffer 计算 `sha256`，查表命中时跳过转码与 MinIO 写入，直接返回已存在对象的 URL 并将 `refCount + 1`
- [x] 2.2 未命中时维持现有转码流程（WebP + 限宽 1600px），写入 MinIO 成功后新建一条 `refCount = 1` 的记录
- [x] 2.3 处理并发上传相同新内容的插入冲突：捕获唯一约束冲突后重新查询该记录并转为执行 `refCount + 1`，不视为异常

## 3. 引用释放与孤儿对象清理

- [x] 3.1 `services/storage.ts` 新增 `releaseImageRef(url)`：按 `url` 查表，命中则 `refCount - 1`；归零时尝试删除对应的 MinIO 物理对象，删除失败仅记录日志，不抛出异常；未命中时无操作
- [x] 3.2 `services/wiki.ts` 的 `updateWikiInfo`：读取旧的 `coverImage`，更新成功后若旧值非空且与新值不同，调用 `releaseImageRef(旧值)`
- [x] 3.3 `services/wiki.ts` 的 `deleteWiki`：删除前读取 `coverImage`，删除成功后若其非空调用 `releaseImageRef`
- [x] 3.4 `services/document.ts` 的 `updateDocument`：读取旧的 `coverImage`，更新成功后若旧值非空且与新值不同，调用 `releaseImageRef(旧值)`
- [x] 3.5 `services/document.ts` 的 `deleteDocument`：删除前读取 `coverImage`，删除成功后若其非空调用 `releaseImageRef`

## 4. 验证

- [x] 4.1 `apps/api` 的 `typecheck` 通过，`prisma validate`/`generate` 通过
- [x] 4.2 验证核心场景：①重复上传同一文件命中去重、返回同一 URL、`refCount` 正确自增；②首次上传创建 `refCount = 1` 的新记录；③替换/清空 Wiki 或 Document 的封面图后旧记录 `refCount` 正确自减；④`refCount` 归零时尝试删除物理对象；⑤删除 Wiki/Document 释放其封面图引用；⑥释放一个不存在于表中的旧 URL 时为无操作、不报错
- [x] 4.3 清理验证过程中产生的临时脚本/测试数据，不留入正式代码
