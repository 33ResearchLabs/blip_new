# T33 Task System - Design & Style Guide

A comprehensive guide to recreate this dark-themed, real-time collaborative app with widgets and modern UI patterns.

---

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Real-time**: Socket.IO (WebSocket)
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Date Handling**: date-fns
- **Auth**: Cookie-based with JWT tokens

---

## Color Palette

### Primary Colors
```css
/* Brand Orange - Primary accent */
--primary: #ff6b35;
--primary-hover: #ff8c50;
--primary-active: #e55f2f;
--primary-muted: rgba(255, 107, 53, 0.1);
--primary-border: rgba(255, 107, 53, 0.3);

/* Text on primary buttons */
--on-primary: #000000;
```

### Background Colors
```css
/* Main backgrounds - Very dark */
--bg-base: #0a0a0a;
--bg-card: #0d0d0d;
--bg-elevated: #131313;
--bg-modal: #1a1a1a;
--bg-input: #252525;
--bg-hover: rgba(255, 255, 255, 0.02);
--bg-active: rgba(255, 255, 255, 0.04);
```

### Border Colors
```css
--border-subtle: rgba(255, 255, 255, 0.04);
--border-default: rgba(255, 255, 255, 0.08);
--border-strong: rgba(255, 255, 255, 0.12);
--border-gray: #374151; /* gray-700 */
--border-gray-dark: #1f2937; /* gray-800 */
```

### Text Colors
```css
--text-primary: #ffffff;
--text-secondary: #d1d5db; /* gray-300 */
--text-muted: #9ca3af; /* gray-400 */
--text-subtle: #6b7280; /* gray-500 */
--text-disabled: #4b5563; /* gray-600 */
```

### Status Colors
```css
/* Success/Green */
--success-bg: rgba(16, 185, 129, 0.1);
--success-border: rgba(16, 185, 129, 0.3);
--success-text: #34d399; /* emerald-400 */

/* Warning/Yellow */
--warning-bg: rgba(234, 179, 8, 0.1);
--warning-border: rgba(234, 179, 8, 0.3);
--warning-text: #fcd34d; /* yellow-300 */

/* Error/Red */
--error-bg: rgba(239, 68, 68, 0.1);
--error-border: rgba(239, 68, 68, 0.3);
--error-text: #f87171; /* red-400 */

/* Info/Blue */
--info-bg: rgba(59, 130, 246, 0.1);
--info-border: rgba(59, 130, 246, 0.3);
--info-text: #60a5fa; /* blue-400 */

/* Purple/Milestone */
--purple-bg: rgba(168, 85, 247, 0.1);
--purple-border: rgba(168, 85, 247, 0.3);
--purple-text: #c084fc; /* purple-400 */
```

---

## Typography

```css
/* Font stack - System fonts for performance */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

/* Sizes */
--text-2xl: 1.5rem;    /* 24px - Page titles */
--text-xl: 1.25rem;    /* 20px - Modal titles */
--text-lg: 1.125rem;   /* 18px - Section headers */
--text-base: 1rem;     /* 16px - Body text */
--text-sm: 0.875rem;   /* 14px - Card content */
--text-xs: 0.75rem;    /* 12px - Labels, metadata */
--text-xxs: 0.625rem;  /* 10px - Timestamps, badges */

/* Weights */
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

---

## Component Patterns

### 1. Card/Widget Container
```tsx
<div className="bg-[#0d0d0d] rounded-xl border border-white/[0.04] overflow-hidden">
  {/* Header */}
  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.04] bg-black/40">
    <span className="text-sm">📊</span>
    <span className="text-xs font-semibold text-white">Widget Title</span>
    <span className="ml-auto text-xs text-gray-500 bg-white/[0.06] px-1.5 py-0.5 rounded">
      {count}
    </span>
  </div>

  {/* Content */}
  <div className="p-3">
    {/* Widget content */}
  </div>
</div>
```

### 2. Modal/Dialog
```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
  {/* Backdrop */}
  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

  {/* Modal */}
  <div className="relative w-full max-w-md bg-[#1a1a1a] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
    {/* Header */}
    <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
      <div className="flex items-center gap-2">
        <span className="text-xl">🎯</span>
        <h2 className="text-lg font-semibold text-white">Modal Title</h2>
      </div>
      <button
        onClick={onClose}
        className="p-1.5 text-gray-500 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all"
      >
        <XIcon className="w-5 h-5" />
      </button>
    </div>

    {/* Body */}
    <div className="p-5 space-y-4">
      {/* Content */}
    </div>

    {/* Footer */}
    <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/[0.08] bg-black/20">
      <button className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
        Cancel
      </button>
      <button className="px-4 py-2 bg-[#ff6b35] hover:bg-[#ff8c50] rounded-lg text-sm font-medium text-black transition-all">
        Confirm
      </button>
    </div>
  </div>
</div>
```

### 3. Mobile Bottom Sheet Modal
```tsx
<div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
  <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

  <div className="relative bg-[#1a1a1a] md:rounded-xl border-t md:border border-gray-800 shadow-xl w-full md:max-w-lg md:mx-4 max-h-[90vh] md:max-h-[85vh] overflow-hidden rounded-t-2xl animate-in fade-in slide-in-from-bottom-4 md:zoom-in-95 duration-200">
    {/* Mobile drag indicator */}
    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-600 rounded-full md:hidden" />

    {/* Content */}
  </div>
</div>
```

### 4. Primary Button
```tsx
<button className="flex items-center gap-2 px-4 py-2 bg-[#ff6b35] hover:bg-[#ff8c50] active:bg-[#e55f2f] rounded-lg text-sm font-medium text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed">
  <PlusIcon className="w-4 h-4" />
  Create Task
</button>
```

### 5. Secondary/Outline Button
```tsx
<button className="px-4 py-2 border border-gray-700 text-gray-300 rounded-lg hover:bg-[#252525] active:bg-[#303030] transition-colors">
  Cancel
</button>
```

### 6. Danger Button
```tsx
<button className="px-4 py-2 border border-red-800 text-red-400 rounded-lg hover:bg-red-900/30 active:bg-red-900/50 transition-colors">
  Delete
</button>
```

### 7. Text Input
```tsx
<input
  type="text"
  placeholder="Enter value..."
  className="w-full px-3 py-2 bg-[#252525] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-[#ff6b35] focus:border-[#ff6b35] outline-none"
/>
```

### 8. Textarea
```tsx
<textarea
  rows={3}
  placeholder="Add a note..."
  className="w-full px-3 py-2 bg-[#252525] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-[#ff6b35] focus:border-[#ff6b35] outline-none resize-none"
/>
```

### 9. Status Badge
```tsx
const statusColors = {
  active: 'bg-[#ff6b35]/20 text-[#ff6b35] border border-[#ff6b35]/50',
  ongoing: 'bg-yellow-900/50 text-yellow-300 border border-yellow-800',
  pending: 'bg-blue-900/50 text-blue-300 border border-blue-800',
  completed: 'bg-emerald-900/50 text-emerald-300 border border-emerald-800',
  cancelled: 'bg-gray-900/50 text-gray-300 border border-gray-800',
}

<span className={`px-2 py-1 text-xs font-medium rounded ${statusColors[status]}`}>
  {status}
</span>
```

### 10. Avatar Component
```tsx
interface AvatarProps {
  name: string
  avatarUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
}

function Avatar({ name, avatarUrl, size = 'md' }: AvatarProps) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`${sizeClasses[size]} rounded-full object-cover`}
      />
    )
  }

  return (
    <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-[#ff6b35] to-[#ff8c50] flex items-center justify-center font-medium text-white`}>
      {initials}
    </div>
  )
}
```

### 11. List Item with Hover
```tsx
<div className="px-3 py-2.5 hover:bg-white/[0.02] transition-colors cursor-pointer">
  <div className="flex items-center gap-3">
    <Avatar name={user.name} size="sm" />
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-white truncate">{title}</p>
      <p className="text-xs text-gray-500">{subtitle}</p>
    </div>
    <span className="text-xs text-gray-600">
      {formatDistanceToNow(date, { addSuffix: true })}
    </span>
  </div>
</div>
```

### 12. Tab Navigation
```tsx
<div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] bg-black/40">
  {tabs.map(tab => (
    <button
      key={tab.id}
      onClick={() => setActiveTab(tab.id)}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
        activeTab === tab.id
          ? 'bg-[#ff6b35]/20 text-[#ff6b35]'
          : 'text-gray-500 hover:text-gray-300'
      }`}
    >
      <span>{tab.icon}</span>
      {tab.label}
    </button>
  ))}
</div>
```

### 13. Notification Badge
```tsx
<div className="relative">
  <BellIcon className="w-5 h-5 text-gray-400" />
  {count > 0 && (
    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
      {count > 9 ? '9+' : count}
    </span>
  )}
</div>
```

### 14. Loading Skeleton
```tsx
<div className="animate-pulse">
  <div className="flex items-center gap-3">
    <div className="w-9 h-9 bg-gray-700 rounded-full" />
    <div className="flex-1">
      <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-700 rounded w-1/2" />
    </div>
  </div>
</div>
```

### 15. Empty State
```tsx
<div className="flex flex-col items-center justify-center py-12 text-gray-600">
  <span className="text-3xl mb-3">📭</span>
  <p className="text-sm font-medium text-gray-400">No items yet</p>
  <p className="text-xs text-gray-600 mt-1">Create your first item to get started</p>
</div>
```

---

## Layout Patterns

### Main App Layout
```tsx
<div className="min-h-screen bg-[#0a0a0a] text-white">
  {/* Header - Fixed */}
  <header className="fixed top-0 left-0 right-0 h-14 bg-[#0d0d0d] border-b border-white/[0.04] z-40">
    {/* Header content */}
  </header>

  {/* Main Content */}
  <main className="pt-14 pb-20 md:pb-0">
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Page content */}
    </div>
  </main>

  {/* Mobile Bottom Nav - Fixed */}
  <nav className="fixed bottom-0 left-0 right-0 h-16 bg-[#0d0d0d] border-t border-white/[0.04] md:hidden z-40">
    {/* Nav items */}
  </nav>
</div>
```

### Three Column Dashboard
```tsx
<div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
  {/* Left Sidebar - Activity Feed */}
  <aside className="lg:col-span-3 space-y-4">
    <ActivityFeedWidget />
    <LeaderboardWidget />
  </aside>

  {/* Main Content - Task Board */}
  <main className="lg:col-span-6">
    <TaskBoard />
  </main>

  {/* Right Sidebar - Chat/Details */}
  <aside className="lg:col-span-3 space-y-4">
    <ChatWidget />
    <QuickActionsWidget />
  </aside>
</div>
```

### Kanban Board Layout
```tsx
<div className="flex gap-4 overflow-x-auto pb-4">
  {columns.map(column => (
    <div key={column.id} className="flex-shrink-0 w-72">
      {/* Column Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{column.icon}</span>
          <h3 className="text-sm font-semibold text-white">{column.title}</h3>
          <span className="text-xs text-gray-500 bg-white/[0.06] px-1.5 py-0.5 rounded">
            {column.items.length}
          </span>
        </div>
      </div>

      {/* Column Content */}
      <div className="space-y-2">
        {column.items.map(item => (
          <TaskCard key={item.id} task={item} />
        ))}
      </div>
    </div>
  ))}
</div>
```

---

## Animation Classes

```css
/* Tailwind animations to add to tailwind.config.js */
module.exports = {
  theme: {
    extend: {
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'slide-down': 'slideDown 0.2s ease-out',
        'scale-in': 'scaleIn 0.15s ease-out',
        'pulse-slow': 'pulse 3s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
}
```

---

## Zustand Store Pattern

```tsx
import { create } from 'zustand'

interface AppState {
  // Data
  items: Item[]
  currentUser: User | null

  // UI State
  selectedItemId: string | null
  isModalOpen: boolean

  // Actions
  setItems: (items: Item[]) => void
  addItem: (item: Item) => void
  updateItem: (item: Item) => void
  removeItem: (id: string) => void
  setSelectedItemId: (id: string | null) => void
  setModalOpen: (open: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  // Initial state
  items: [],
  currentUser: null,
  selectedItemId: null,
  isModalOpen: false,

  // Actions
  setItems: (items) => set({ items }),
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
  updateItem: (item) => set((state) => ({
    items: state.items.map((i) => (i.id === item.id ? item : i)),
  })),
  removeItem: (id) => set((state) => ({
    items: state.items.filter((i) => i.id !== id),
  })),
  setSelectedItemId: (id) => set({ selectedItemId: id }),
  setModalOpen: (open) => set({ isModalOpen: open }),
}))
```

---

## Socket.IO Real-time Pattern

### Server Setup
```tsx
// lib/socket-server.ts
import { Server as SocketServer } from 'socket.io'

let io: SocketServer | null = null

export function initSocketServer(server: any) {
  io = new SocketServer(server, {
    cors: { origin: '*' },
    path: '/api/socketio',
  })

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id)

    socket.on('join-room', (roomId: string) => {
      socket.join(roomId)
    })

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id)
    })
  })
}

export function broadcastUpdate(event: string, data: any) {
  io?.emit(event, data)
}
```

### Client Hook
```tsx
// hooks/useSocket.ts
import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

export function useSocket(onMessage: (event: string, data: any) => void) {
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    socketRef.current = io({
      path: '/api/socketio',
    })

    socketRef.current.on('connect', () => {
      console.log('Socket connected')
    })

    socketRef.current.on('item-update', (data) => {
      onMessage('item-update', data)
    })

    socketRef.current.on('new-message', (data) => {
      onMessage('new-message', data)
    })

    return () => {
      socketRef.current?.disconnect()
    }
  }, [onMessage])

  return socketRef.current
}
```

---

## API Route Pattern

```tsx
// app/api/items/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserIdFromRequest } from '@/lib/auth'

// GET /api/items
export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const items = await prisma.item.findMany({
    where: { userId },
    include: {
      creator: { select: { id: true, name: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(items)
}

// POST /api/items
export async function POST(request: NextRequest) {
  const userId = getUserIdFromRequest(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { title, description } = body

  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const item = await prisma.item.create({
    data: {
      title,
      description,
      createdById: userId,
    },
    include: {
      creator: { select: { id: true, name: true, avatarUrl: true } },
    },
  })

  // Broadcast to connected clients
  broadcastUpdate('item-created', item)

  return NextResponse.json(item, { status: 201 })
}
```

---

## Prisma Schema Pattern

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String
  avatarUrl String?
  role      String   @default("member")
  coins     Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  createdItems Item[]    @relation("ItemCreator")
  assignments  Assignment[]
  messages     Message[]

  @@index([email])
}

enum ItemStatus {
  ACTIVE
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

model Item {
  id          String     @id @default(uuid())
  title       String
  description String?
  status      ItemStatus @default(ACTIVE)
  points      Int        @default(10)
  dueAt       DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  createdById String
  createdBy   User @relation("ItemCreator", fields: [createdById], references: [id])

  assignments Assignment[]
  thread      Thread?

  @@index([status])
  @@index([createdById])
}

model Assignment {
  id        String   @id @default(uuid())
  itemId    String
  userId    String
  assignedAt DateTime @default(now())

  item Item @relation(fields: [itemId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id])

  @@unique([itemId, userId])
}

model Thread {
  id        String   @id @default(uuid())
  itemId    String   @unique
  createdAt DateTime @default(now())

  item     Item      @relation(fields: [itemId], references: [id], onDelete: Cascade)
  messages Message[]
}

model Message {
  id        String   @id @default(uuid())
  threadId  String
  senderId  String
  content   String
  createdAt DateTime @default(now())

  thread Thread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  sender User   @relation(fields: [senderId], references: [id])

  @@index([threadId])
}
```

---

## File Structure

```
src/
├── app/
│   ├── api/
│   │   ├── items/
│   │   │   ├── route.ts              # GET, POST /api/items
│   │   │   └── [id]/
│   │   │       └── route.ts          # GET, PATCH, DELETE /api/items/[id]
│   │   ├── users/
│   │   │   └── route.ts
│   │   ├── messages/
│   │   │   └── route.ts
│   │   └── auth/
│   │       └── route.ts
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Home page
│   └── globals.css                   # Global styles
├── components/
│   ├── ui/                           # Reusable UI components
│   │   ├── Avatar.tsx
│   │   ├── Button.tsx
│   │   ├── Modal.tsx
│   │   └── Badge.tsx
│   ├── widgets/                      # Dashboard widgets
│   │   ├── ActivityFeed.tsx
│   │   ├── Leaderboard.tsx
│   │   └── QuickActions.tsx
│   ├── ItemBoard.tsx                 # Main kanban board
│   ├── ItemCard.tsx                  # Individual item card
│   ├── ItemDetailModal.tsx           # Item detail view
│   ├── ChatPanel.tsx                 # Chat/messaging
│   └── Header.tsx                    # App header
├── hooks/
│   ├── useSocket.ts                  # Socket.IO hook
│   └── useAuth.ts                    # Auth hook
├── lib/
│   ├── prisma.ts                     # Prisma client
│   ├── auth.ts                       # Auth utilities
│   └── socket-server.ts              # Socket server
├── store/
│   └── useStore.ts                   # Zustand store
└── types/
    └── index.ts                      # TypeScript types
```

---

## Key Features to Include

1. **Real-time Updates**: WebSocket for instant updates across all clients
2. **Gamification**: Points/coins system, leaderboard, achievements
3. **Activity Feed**: Live stream of actions with meme-style messages
4. **Chat/Messaging**: Threaded conversations per item
5. **Role-based Access**: Admin, manager, member permissions
6. **Mobile-first**: Responsive design with bottom sheets on mobile
7. **Dark Theme**: Consistent dark UI with accent colors
8. **Status Workflow**: State machine for item lifecycle
9. **Time Tracking**: Due dates, extensions, overdue handling
10. **Notifications**: In-app notifications with badges

---

## Quick Start Prompt for Claude

```
Create a [YOUR APP TYPE] app using:
- Next.js 14 App Router + TypeScript
- PostgreSQL + Prisma
- Socket.IO for real-time
- Zustand for state
- Tailwind CSS with dark theme

Design system:
- Background: #0a0a0a base, #0d0d0d cards, #1a1a1a modals
- Primary accent: #ff6b35 orange
- Borders: rgba(255,255,255,0.04) subtle, 0.08 default
- Cards: rounded-xl, border border-white/[0.04]
- Buttons: rounded-lg, primary bg-[#ff6b35] text-black

Include:
- Kanban board with drag-and-drop
- Real-time activity feed widget
- Leaderboard with points system
- Chat panel for items
- Mobile bottom sheet modals
- Loading skeletons and empty states

See STYLE_GUIDE.md for complete component patterns and examples.
```

---

This guide captures the essence of the T33 Task System design. Use it as a reference when building similar apps!
