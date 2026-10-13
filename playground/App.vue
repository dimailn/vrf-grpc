<template>
  <main class="app">
    <header class="app-head">
      <h1>vrf-grpc</h1>
      <p class="hint">
        A master–detail Todo list. The form on the right is an
        <code>&lt;rf-form&gt;</code> driven by the gRPC (Connect) adapter —
        selecting an item loads it via <code>GetTodo</code>, saving goes through
        <code>CreateTodo</code>&nbsp;/&nbsp;<code>UpdateTodo</code>.
      </p>
    </header>

    <div class="layout">
      <!-- ───────── list ───────── -->
      <section class="card list-card">
        <div class="card-head">
          <h2>Todos <span class="badge">{{ todos.length }}</span></h2>
          <button class="btn-ghost" :class="{ active: !selectedId }" @click="newTodo">+ New</button>
        </div>

        <p v-if="!todos.length" class="muted empty">Nothing here yet.</p>

        <ul v-else class="list">
          <li
            v-for="todo in todos"
            :key="todo.id"
            class="item"
            :class="{ selected: todo.id === selectedId }"
            @click="select(todo.id)"
          >
            <input
              type="checkbox"
              :checked="todo.completed"
              @click.stop
              @change="toggle(todo)"
            />
            <span class="title" :class="{ done: todo.completed }">
              {{ todo.title }}
              <small v-if="todo.description" class="muted">— {{ todo.description }}</small>
            </span>
            <span class="spacer" />
            <span class="chevron">›</span>
          </li>
        </ul>
      </section>

      <!-- ───────── form panel ───────── -->
      <section class="card panel">
        <div class="card-head">
          <h2>{{ selectedId ? `Edit #${selectedId}` : 'New todo' }}</h2>
          <code class="rpc-tag">{{ selectedId ? 'GetTodo · UpdateTodo' : 'CreateTodo' }}</code>
        </div>

        <rf-form
          :key="formKey"
          name="Todo"
          :rf-id="selectedId ?? undefined"
          auto
          @update:saving="saving = $event"
          @after-submit-success="onSaved"
        >
          <rf-input name="title" label="Title" />
          <rf-input name="description" label="Description" />
          <rf-checkbox v-if="selectedId" name="completed" label="Completed" />

          <div class="form-actions">
            <button
              v-if="selectedId"
              type="button"
              class="btn-ghost danger"
              @click="remove(selectedId)"
            >
              Delete
            </button>
            <span class="spacer" />
            <button v-if="selectedId" type="button" class="btn-ghost" @click="newTodo">
              Cancel
            </button>
            <rf-submit>{{ saving ? 'Saving…' : selectedId ? 'Save' : 'Add' }}</rf-submit>
          </div>
        </rf-form>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { todoClient } from './api'

const todos = ref<any[]>([])
const selectedId = ref<string | null>(null)
const saving = ref(false)
const createNonce = ref(0)

// Remounting the form (via :key) reloads it: a new key in edit mode refetches
// GetTodo; bumping the nonce in create mode gives a fresh, empty form.
const formKey = computed(() =>
  selectedId.value ? `edit-${selectedId.value}` : `new-${createNonce.value}`,
)

async function reload() {
  const res = await todoClient.listTodos({})
  todos.value = [...res.todos].sort((a, b) => Number(a.id) - Number(b.id))
}

reload()

function select(id: string) {
  selectedId.value = id
}

function newTodo() {
  selectedId.value = null
}

async function toggle(todo: any) {
  await todoClient.updateTodo({ id: todo.id, todo: { ...todo, completed: !todo.completed } })
  await reload()
}

async function remove(id: string) {
  await todoClient.deleteTodo({ id })
  if (selectedId.value === id) selectedId.value = null
  await reload()
}

async function onSaved() {
  await reload()
  if (!selectedId.value) createNonce.value++ // clear the create form
}
</script>

<style>
:root {
  --fg: #1f2328;
  --muted: #8b949e;
  --border: #e4e7eb;
  --bg: #fafbfc;
  --card: #fff;
  --accent: #2f6feb;
  --accent-soft: #eaf1fe;
  --danger: #cf222e;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); }

.app {
  max-width: 54rem;
  margin: 2.5rem auto;
  padding: 0 1rem;
  font-family: system-ui, -apple-system, sans-serif;
  color: var(--fg);
}
.app-head h1 { margin: 0 0 0.25rem; font-size: 1.5rem; letter-spacing: -0.01em; }
.hint { color: var(--muted); font-size: 0.85rem; line-height: 1.5; margin: 0 0 1.25rem; }
code { background: #f0f1f3; padding: 0 0.25rem; border-radius: 4px; font-size: 0.85em; }

/* layout: two columns on wide screens, stacked on narrow */
.layout {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
  align-items: start;
}
@media (min-width: 720px) {
  .layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .panel { position: sticky; top: 1.5rem; }
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem 1.1rem;
}
.card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 0.75rem;
}
.card-head h2 { margin: 0; font-size: 1rem; display: flex; align-items: center; gap: 0.5rem; }
.badge {
  background: #f0f1f3; color: var(--muted);
  border-radius: 999px; padding: 0.05rem 0.55rem; font-size: 0.78rem; font-weight: 600;
}
.rpc-tag { color: var(--muted); font-size: 0.72rem; }

/* list */
.list { list-style: none; padding: 0; margin: 0; }
.empty { padding: 0.5rem 0; }
.item {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.55rem 0.5rem; margin: 0 -0.5rem;
  border-radius: 8px; cursor: pointer;
}
.item + .item { border-top: 1px solid var(--border); }
.item:hover { background: #f6f8fa; }
.item.selected { background: var(--accent-soft); border-top-color: transparent; }
.item.selected + .item { border-top-color: transparent; }
.title { font-size: 0.95rem; line-height: 1.3; }
.done { text-decoration: line-through; color: var(--muted); }
.spacer { flex: 1; }
.chevron { color: var(--muted); font-size: 1.1rem; }
.muted { color: var(--muted); }
small.muted { font-size: 0.8rem; }

/* vrf kit */
.rf-field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.85rem; }
.rf-label { font-size: 0.78rem; color: var(--muted); font-weight: 600; }
.rf-control {
  width: 100%;
  padding: 0.55rem 0.65rem; font-size: 0.95rem;
  border: 1px solid var(--border); border-radius: 7px; outline: none;
  transition: border-color 0.12s;
}
.rf-control:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.rf-field--error .rf-control { border-color: var(--danger); }
.rf-error { color: var(--danger); font-size: 0.78rem; }
.rf-check {
  display: flex; align-items: center; gap: 0.45rem;
  margin-bottom: 0.85rem; font-size: 0.9rem;
}

/* buttons */
.form-actions {
  display: flex; align-items: center; gap: 0.5rem;
  margin-top: 1.1rem; padding-top: 0.9rem; border-top: 1px solid var(--border);
}
.rf-btn {
  background: var(--accent); color: #fff; border: none;
  padding: 0.5rem 1.1rem; border-radius: 7px; font-size: 0.9rem; font-weight: 500;
  cursor: pointer;
}
.rf-btn:disabled { opacity: 0.55; cursor: default; }
.btn-ghost {
  background: none; border: 1px solid transparent; color: var(--muted);
  padding: 0.45rem 0.7rem; border-radius: 7px; font-size: 0.88rem; cursor: pointer;
}
.btn-ghost:hover { background: #f0f1f3; color: var(--fg); }
.btn-ghost.active { color: var(--accent); }
.btn-ghost.danger { color: var(--danger); }
.btn-ghost.danger:hover { background: #fcebec; }
</style>
