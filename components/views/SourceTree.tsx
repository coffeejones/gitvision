"use client";

// Collapsible file explorer for the Source view. Pure UI over the TreeNode[]
// buildFileTree produces — selection + open/closed state only.

import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileCode2,
  Folder,
  FolderOpen,
} from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import type { TreeNode } from "@/lib/fileTree";

export function SourceTree({
  nodes,
  selected,
  onSelect,
  defaultOpen,
}: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  defaultOpen: Set<string>;
}) {
  return (
    <div className="py-2 text-[13px]">
      {nodes.map((n) => (
        <Row
          key={n.path}
          node={n}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          defaultOpen={defaultOpen}
        />
      ))}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
  defaultOpen: Set<string>;
}

function Row(props: RowProps) {
  return props.node.type === "dir" ? <DirRow {...props} /> : <FileRow {...props} />;
}

function DirRow({ node, depth, selected, onSelect, defaultOpen }: RowProps) {
  const [open, setOpen] = useState(() => defaultOpen.has(node.path));
  if (node.type !== "dir") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full text-left h-7 transition hover:bg-white/[0.03]"
        style={{ paddingLeft: depth * 12 + 8, paddingRight: 8, color: TOK.textSecondary }}
      >
        {open ? (
          <ChevronDown size={13} className="flex-shrink-0" style={{ color: TOK.textMuted }} />
        ) : (
          <ChevronRight size={13} className="flex-shrink-0" style={{ color: TOK.textMuted }} />
        )}
        {open ? (
          <FolderOpen size={14} className="flex-shrink-0" style={{ color: TOK.textMuted }} />
        ) : (
          <Folder size={14} className="flex-shrink-0" style={{ color: TOK.textMuted }} />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open &&
        node.children.map((c) => (
          <Row
            key={c.path}
            node={c}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
            defaultOpen={defaultOpen}
          />
        ))}
    </>
  );
}

function FileRow({ node, depth, selected, onSelect }: RowProps) {
  if (node.type !== "file") return null;
  const active = selected === node.path;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className="flex items-center gap-1.5 w-full text-left h-7 transition"
      style={{
        paddingLeft: depth * 12 + 8 + 13, // align past the chevron column
        paddingRight: 8,
        color: active ? TOK.textPrimary : TOK.textSecondary,
        background: active ? "rgba(255,255,255,0.06)" : undefined,
        boxShadow: active ? `inset 2px 0 0 ${TOK.accent}` : undefined,
      }}
    >
      <FileCode2 size={14} className="flex-shrink-0" style={{ color: TOK.textMuted }} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}
