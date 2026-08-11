import { useState } from "react";
import { useLocation } from "wouter";
import { Bell, Clock, FileText, Info } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
  type Notification,
} from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useListNotifications({
    query: {
      refetchInterval: 30000,
      queryKey: getListNotificationsQueryKey(),
    },
  });

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      markRead.mutate(
        { id: notification.id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
          },
        },
      );
    }
    if (notification.link) {
      setLocation(notification.link);
      setOpen(false);
    }
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
      },
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-lg">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 h-4 min-w-4 px-1 rounded-lg bg-foreground text-background text-[10px] font-mono flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 rounded-lg border-border" align="end">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <h4 className="font-mono uppercase tracking-wider text-sm font-semibold">
            Notifications
          </h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-1 px-2 text-[10px] uppercase font-mono tracking-widest rounded-lg"
              onClick={handleMarkAllRead}
              disabled={markAllRead.isPending}
            >
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-sm font-mono uppercase tracking-widest text-muted-foreground">
              No notifications
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.slice(0, 15).map((notification) => {
                const Icon =
                  notification.type === "reminder"
                    ? Clock
                    : notification.type === "document_request"
                      ? FileText
                      : Info;

                return (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`flex items-start gap-3 p-4 text-left transition-colors border-b border-border last:border-b-0 hover:bg-muted/50 ${
                      !notification.read
                        ? "bg-muted/10 border-l-4 border-l-foreground"
                        : "border-l-4 border-l-transparent opacity-70"
                    }`}
                  >
                    <div className="shrink-0 mt-0.5">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 space-y-1 overflow-hidden">
                      <p className="text-sm font-medium leading-tight">{notification.message}</p>
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                        {new Date(notification.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
