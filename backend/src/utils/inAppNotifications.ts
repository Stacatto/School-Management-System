import prisma from '../config/database';

export const notificationCategories = ['assignments', 'attendance', 'fees', 'grades', 'messages', 'announcements'] as const;
export type NotificationCategory = typeof notificationCategories[number];

export const defaultNotificationPreferences: Record<NotificationCategory, boolean> = {
  assignments: true,
  attendance: true,
  fees: true,
  grades: true,
  messages: true,
  announcements: true,
};

export function normalizeNotificationPreferences(value: unknown): Record<NotificationCategory, boolean> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(notificationCategories.map(category => [category, source[category] !== false])) as Record<NotificationCategory, boolean>;
}

export function notificationCategoryEnabled(value: unknown, category: NotificationCategory): boolean {
  return normalizeNotificationPreferences(value)[category];
}

export async function notifyUsers(userIds: string[], title: string, message: string, category?: NotificationCategory) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueUserIds.length) return;
  try {
    let recipientIds = uniqueUserIds;
    if (category) {
      const users = await prisma.user.findMany({ where: { id: { in: uniqueUserIds } }, select: { id: true, notificationPreferences: true } });
      recipientIds = users.filter(user => notificationCategoryEnabled(user.notificationPreferences, category)).map(user => user.id);
    }
    if (recipientIds.length) await prisma.notification.createMany({ data: recipientIds.map(userId => ({ userId, title, message })) });
  } catch (error) {
    // Keep the underlying school action successful if notifications are unavailable.
    console.error('Could not save in-app notifications', error);
  }
}
