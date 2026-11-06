import prisma from '../config/database';

export async function notifyUsers(userIds: string[], title: string, message: string) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueUserIds.length) return;
  try {
    await prisma.notification.createMany({ data: uniqueUserIds.map(userId => ({ userId, title, message })) });
  } catch (error) {
    // Keep the underlying school action successful if notifications are unavailable.
    console.error('Could not save in-app notifications', error);
  }
}
