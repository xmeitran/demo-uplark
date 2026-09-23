"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type Modifier
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ProjectHierarchyOrderKind } from "@b2b-crm/contracts";
import { GripVertical } from "lucide-react";
import { reorderSiblingIds } from "./hierarchy-order";

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

export type SortHandleProps = {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners | undefined;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  disabled: boolean;
};

function SortableItem({
  id,
  hierarchyKind,
  disabled,
  reduceMotion,
  children
}: {
  id: string;
  hierarchyKind: ProjectHierarchyOrderKind;
  disabled: boolean;
  reduceMotion: boolean;
  children: (handle: SortHandleProps) => React.ReactNode;
}) {
  const sortable = useSortable({ id, disabled });
  return (
    <div
      ref={sortable.setNodeRef}
      role="listitem"
      data-hierarchy-kind={hierarchyKind}
      data-hierarchy-id={id}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: reduceMotion ? undefined : sortable.transition,
        opacity: sortable.isDragging ? 0.35 : 1,
        position: "relative",
        zIndex: sortable.isDragging ? 10 : undefined
      }}
    >
      {children({
        attributes: sortable.attributes,
        listeners: sortable.listeners,
        setActivatorNodeRef: sortable.setActivatorNodeRef,
        disabled
      })}
    </div>
  );
}

export function HierarchySortableList({
  ids,
  hierarchyKind,
  disabled = false,
  label,
  listClassName,
  onReorder,
  renderItem,
  renderOverlay,
  getItemLabel = (id) => id
}: {
  ids: readonly string[];
  hierarchyKind: ProjectHierarchyOrderKind;
  disabled?: boolean;
  label: string;
  listClassName?: string;
  onReorder: (orderedIds: string[]) => void;
  renderItem: (id: string, handle: SortHandleProps) => React.ReactNode;
  renderOverlay?: (id: string) => React.ReactNode;
  getItemLabel?: (id: string) => string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const items = useMemo(() => [...ids], [ids]);

  const handleEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const next = reorderSiblingIds(items, String(active.id), over ? String(over.id) : null);
    if (next.some((id, index) => id !== items[index])) onReorder(next);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable: "Nhấn phím cách để nhấc mục, dùng mũi tên để di chuyển, rồi nhấn phím cách để thả."
        },
        announcements: {
          onDragStart: ({ active }) => `Đã nhấc ${getItemLabel(String(active.id))}.`,
          onDragOver: ({ active, over }) => over ? `${getItemLabel(String(active.id))} đang ở trên ${getItemLabel(String(over.id))}.` : undefined,
          onDragEnd: ({ active, over }) => over ? `Đã đặt ${getItemLabel(String(active.id))} tại vị trí của ${getItemLabel(String(over.id))}.` : "Đã hủy sắp xếp.",
          onDragCancel: () => "Đã hủy sắp xếp."
        }
      }}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div
          role="list"
          aria-label={label}
          aria-busy={disabled}
          data-hierarchy-kind={hierarchyKind}
          className={listClassName}
        >
          {items.map((id) => (
            <SortableItem
              key={id}
              id={id}
              hierarchyKind={hierarchyKind}
              disabled={disabled}
              reduceMotion={reduceMotion}
            >
              {(handle) => renderItem(id, handle)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={reduceMotion ? null : undefined}>
        {activeId ? (renderOverlay?.(activeId) ?? (
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground shadow-lg">
            {getItemLabel(activeId)}
          </div>
        )) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function HierarchyDragHandle({
  handle,
  label
}: {
  handle?: SortHandleProps;
  label: string;
}) {
  if (!handle) return null;
  return (
    <button
      ref={handle.setActivatorNodeRef}
      type="button"
      aria-label={label}
      disabled={handle.disabled}
      className="inline-flex min-h-11 min-w-11 shrink-0 touch-none items-center justify-center rounded-lg text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-40"
      {...handle.attributes}
      {...handle.listeners}
    >
      <GripVertical className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
