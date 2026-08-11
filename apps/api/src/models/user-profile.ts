import {prisma} from '../db/prisma';
import type {Gender, UserProfile} from '../generated/prisma/client';

export type {Gender, UserProfile};

export interface UpsertUserProfileInput {
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  gender?: Gender;
  birthday?: Date;
  phone?: string;
}

export function findProfileByUserId(userId: number): Promise<UserProfile | null> {
  return prisma.userProfile.findUnique({where: {userId}});
}

/** 有则更新、无则创建，详情表大部分场景都是这种"确保存在"的写法 */
export function upsertUserProfile(
  userId: number,
  data: UpsertUserProfileInput
): Promise<UserProfile> {
  return prisma.userProfile.upsert({
    where: {userId},
    create: {userId, ...data},
    update: data
  });
}

export function deleteUserProfile(userId: number): Promise<UserProfile> {
  return prisma.userProfile.delete({where: {userId}});
}
