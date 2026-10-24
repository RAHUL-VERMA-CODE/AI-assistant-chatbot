export type ConnectorEventType =
  | 'catalog.menu_updated'
  | 'catalog.stock_changed'
  | 'order.status_changed';

export interface BaseConnectorEvent {
  readonly eventId: string;
  readonly eventType: ConnectorEventType;
  readonly tenantId: string;
  readonly branchId: string;
  readonly occurredAt: string; // ISO 8601 UTC
  readonly version: number;
}

export interface MenuUpdatedEvent extends BaseConnectorEvent {
  readonly eventType: 'catalog.menu_updated';
  readonly newMenuVersion: number;
}

export interface StockChangedEvent extends BaseConnectorEvent {
  readonly eventType: 'catalog.stock_changed';
  readonly itemId: string;
  readonly variantId?: string;
  readonly optionId?: string;
  readonly inStock: boolean;
}

export interface OrderStatusChangedEvent extends BaseConnectorEvent {
  readonly eventType: 'order.status_changed';
  readonly orderId: string;
  readonly newStatus: string;
}

export type ConnectorWebhookEvent =
  | MenuUpdatedEvent
  | StockChangedEvent
  | OrderStatusChangedEvent;
