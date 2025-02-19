import { objectToQuery } from ".";
import type { AuthManager } from "./auth-manager";
import type { NotificationsApi } from "./client";
import {
  convertToInboxNotificationData,
  convertToInboxNotificationDeleteInfo,
  convertToThreadData,
  convertToThreadDeleteInfo,
} from "./convert-plain-data";
import { HttpClient } from "./http-client";
import { Batch } from "./lib/batch";
import type { Store } from "./lib/create-store";
import { url } from "./lib/url";
import { TokenKind } from "./protocol/AuthToken";
import type {
  BaseMetadata,
  QueryMetadata,
  ThreadData,
  ThreadDataPlain,
  ThreadDeleteInfo,
  ThreadDeleteInfoPlain,
} from "./protocol/Comments";
import type {
  InboxNotificationData,
  InboxNotificationDataPlain,
  InboxNotificationDeleteInfo,
  InboxNotificationDeleteInfoPlain,
} from "./protocol/InboxNotifications";

export type GetInboxNotificationsOptions = {
  cursor?: string;
};

export type GetInboxNotificationsSinceOptions = {
  since: Date;
  signal?: AbortSignal;
};

export type GetUserThreadsOptions<M extends BaseMetadata> = {
  cursor?: string;
  query?: {
    resolved?: boolean;
    metadata?: Partial<QueryMetadata<M>>;
  };
};

export type GetUserThreadsSinceOptions = {
  since: Date;
  signal?: AbortSignal;
};

export function createNotificationsApi<M extends BaseMetadata>({
  baseUrl,
  authManager,
  currentUserIdStore,
  fetchPolyfill,
}: {
  baseUrl: string;
  authManager: AuthManager;
  currentUserIdStore: Store<string | null>;
  fetchPolyfill: typeof fetch;
}): NotificationsApi<M> & {
  getUserThreads_experimental(options?: GetUserThreadsOptions<M>): Promise<{
    threads: ThreadData<M>[];
    inboxNotifications: InboxNotificationData[];
    nextCursor: string | null;
    requestedAt: Date;
  }>;
  getUserThreadsSince_experimental(
    options: GetUserThreadsSinceOptions
  ): Promise<{
    inboxNotifications: {
      updated: InboxNotificationData[];
      deleted: InboxNotificationDeleteInfo[];
    };
    threads: {
      updated: ThreadData<M>[];
      deleted: ThreadDeleteInfo[];
    };
    requestedAt: Date;
  }>;
} {
  async function getAuthValue() {
    const authValue = await authManager.getAuthValue({
      requestedScope: "comments:read",
    });

    if (
      authValue.type === "secret" &&
      authValue.token.parsed.k === TokenKind.ACCESS_TOKEN
    ) {
      const userId = authValue.token.parsed.uid;

      // NOTE: currentUserIdStore is updated here as a side-effect!
      currentUserIdStore.set(() => userId);
    }

    return authValue;
  }

  const httpClient = new HttpClient(baseUrl, fetchPolyfill, getAuthValue);

  async function getInboxNotifications(options?: GetInboxNotificationsOptions) {
    const PAGE_SIZE = 50;

    const json = await httpClient.get<{
      threads: ThreadDataPlain<M>[];
      inboxNotifications: InboxNotificationDataPlain[];
      meta: {
        requestedAt: string;
        nextCursor: string | null;
      };
    }>(url`/v2/c/inbox-notifications`, {
      cursor: options?.cursor,
      limit: PAGE_SIZE,
    });

    return {
      inboxNotifications: json.inboxNotifications.map(
        convertToInboxNotificationData
      ),
      threads: json.threads.map(convertToThreadData),
      nextCursor: json.meta.nextCursor,
      requestedAt: new Date(json.meta.requestedAt),
    };
  }

  async function getInboxNotificationsSince(
    options: GetInboxNotificationsSinceOptions
  ) {
    const json = await httpClient.get<{
      threads: ThreadDataPlain<M>[];
      inboxNotifications: InboxNotificationDataPlain[];
      deletedThreads: ThreadDeleteInfoPlain[];
      deletedInboxNotifications: InboxNotificationDeleteInfoPlain[];
      meta: {
        requestedAt: string;
      };
    }>(
      url`/v2/c/inbox-notifications/delta`,
      { since: options.since.toISOString() },
      { signal: options?.signal }
    );
    return {
      inboxNotifications: {
        updated: json.inboxNotifications.map(convertToInboxNotificationData),
        deleted: json.deletedInboxNotifications.map(
          convertToInboxNotificationDeleteInfo
        ),
      },
      threads: {
        updated: json.threads.map(convertToThreadData),
        deleted: json.deletedThreads.map(convertToThreadDeleteInfo),
      },
      requestedAt: new Date(json.meta.requestedAt),
    };
  }

  async function getUnreadInboxNotificationsCount() {
    const { count } = await httpClient.get<{ count: number }>(
      url`/v2/c/inbox-notifications/count`
    );
    return count;
  }

  async function markAllInboxNotificationsAsRead() {
    await httpClient.post(url`/v2/c/inbox-notifications/read`, {
      inboxNotificationIds: "all",
    });
  }

  async function markInboxNotificationsAsRead(inboxNotificationIds: string[]) {
    await httpClient.post(url`/v2/c/inbox-notifications/read`, {
      inboxNotificationIds,
    });
  }

  const batchedMarkInboxNotificationsAsRead = new Batch<string, string>(
    async (batchedInboxNotificationIds) => {
      const inboxNotificationIds = batchedInboxNotificationIds.flat();

      await markInboxNotificationsAsRead(inboxNotificationIds);

      return inboxNotificationIds;
    },
    { delay: 50 }
  );

  async function markInboxNotificationAsRead(inboxNotificationId: string) {
    await batchedMarkInboxNotificationsAsRead.get(inboxNotificationId);
  }

  async function deleteAllInboxNotifications() {
    await httpClient.delete(url`/v2/c/inbox-notifications`);
  }

  async function deleteInboxNotification(inboxNotificationId: string) {
    await httpClient.delete(
      url`/v2/c/inbox-notifications/${inboxNotificationId}`
    );
  }

  async function getUserThreads_experimental(
    options: GetUserThreadsOptions<M>
  ) {
    let query: string | undefined;

    if (options?.query) {
      query = objectToQuery(options.query);
    }

    const PAGE_SIZE = 50;

    const json = await httpClient.get<{
      threads: ThreadDataPlain<M>[];
      inboxNotifications: InboxNotificationDataPlain[];
      deletedThreads: ThreadDeleteInfoPlain[];
      deletedInboxNotifications: InboxNotificationDeleteInfoPlain[];
      meta: {
        requestedAt: string;
        nextCursor: string | null;
      };
    }>(url`/v2/c/threads`, {
      cursor: options.cursor,
      query,
      limit: PAGE_SIZE,
    });

    return {
      threads: json.threads.map(convertToThreadData),
      inboxNotifications: json.inboxNotifications.map(
        convertToInboxNotificationData
      ),
      nextCursor: json.meta.nextCursor,
      requestedAt: new Date(json.meta.requestedAt),
    };
  }

  async function getUserThreadsSince_experimental(
    options: GetUserThreadsSinceOptions
  ) {
    const json = await httpClient.get<{
      threads: ThreadDataPlain<M>[];
      inboxNotifications: InboxNotificationDataPlain[];
      deletedThreads: ThreadDeleteInfoPlain[];
      deletedInboxNotifications: InboxNotificationDeleteInfoPlain[];
      meta: {
        requestedAt: string;
      };
    }>(
      url`/v2/c/threads/delta`,
      { since: options.since.toISOString() },
      { signal: options.signal }
    );

    return {
      threads: {
        updated: json.threads.map(convertToThreadData),
        deleted: json.deletedThreads.map(convertToThreadDeleteInfo),
      },
      inboxNotifications: {
        updated: json.inboxNotifications.map(convertToInboxNotificationData),
        deleted: json.deletedInboxNotifications.map(
          convertToInboxNotificationDeleteInfo
        ),
      },
      requestedAt: new Date(json.meta.requestedAt),
    };
  }

  return {
    getInboxNotifications,
    getInboxNotificationsSince,
    getUnreadInboxNotificationsCount,
    markAllInboxNotificationsAsRead,
    markInboxNotificationAsRead,
    deleteAllInboxNotifications,
    deleteInboxNotification,
    getUserThreads_experimental,
    getUserThreadsSince_experimental,
  };
}
