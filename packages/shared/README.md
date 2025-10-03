# @charivo/shared

Shared utilities, constants, and helper functions for the Charivo framework.

## Features

- 🔧 **Utility Functions** - Common helpers for ID generation, timestamps, etc.
- ⚡ **Performance Helpers** - Debounce and throttle implementations
- 📦 **Constants** - Shared configuration and defaults
- 🎯 **Type-Safe** - Full TypeScript support

## Installation

```bash
pnpm add @charivo/shared
```

## Usage

### ID Generation

```typescript
import { generateId } from "@charivo/shared";

const id = generateId();
// → "x7k2m9p4q"
```

### Timestamp Formatting

```typescript
import { formatTimestamp } from "@charivo/shared";

const timestamp = formatTimestamp(new Date());
// → "2024-10-03T12:34:56.789Z"
```

### Debounce

Delays function execution until after a specified wait period has elapsed since the last call.

```typescript
import { debounce } from "@charivo/shared";

const handleInput = debounce((value: string) => {
  console.log("Search:", value);
}, 300);

// Only logs once after 300ms of no input
handleInput("a");
handleInput("ab");
handleInput("abc"); // Only this will log after 300ms
```

### Throttle

Ensures function is called at most once per specified time period.

```typescript
import { throttle } from "@charivo/shared";

const handleScroll = throttle(() => {
  console.log("Scrolling...");
}, 100);

// Logs at most once per 100ms, no matter how fast you scroll
window.addEventListener("scroll", handleScroll);
```

### Constants

```typescript
import { CHARIVO_VERSION, DEFAULT_CONFIG } from "@charivo/shared";

console.log(CHARIVO_VERSION); // "0.0.0"

console.log(DEFAULT_CONFIG);
// {
//   maxMessages: 100,
//   responseTimeout: 30000,
//   retryAttempts: 3
// }
```

## API Reference

### Functions

#### `generateId(): string`
Generate a random unique ID.

```typescript
const id = generateId(); // "x7k2m9p4q"
```

#### `formatTimestamp(date: Date): string`
Format a date as ISO 8601 timestamp.

```typescript
formatTimestamp(new Date()); // "2024-10-03T12:34:56.789Z"
```

#### `debounce<T>(func: T, wait: number)`
Create a debounced version of a function.

```typescript
const debouncedFn = debounce((value: string) => {
  console.log(value);
}, 300);
```

**Parameters:**
- `func: T` - Function to debounce
- `wait: number` - Wait time in milliseconds

#### `throttle<T>(func: T, limit: number)`
Create a throttled version of a function.

```typescript
const throttledFn = throttle(() => {
  console.log("Called!");
}, 100);
```

**Parameters:**
- `func: T` - Function to throttle
- `limit: number` - Time limit in milliseconds

### Constants

#### `CHARIVO_VERSION: string`
Current version of the Charivo framework.

#### `DEFAULT_CONFIG`
Default configuration values.

```typescript
{
  maxMessages: 100,         // Max messages in history
  responseTimeout: 30000,   // API timeout (ms)
  retryAttempts: 3         // Number of retry attempts
}
```

## Use Cases

### React: Debounced Search

```typescript
import { debounce } from "@charivo/shared";
import { useState, useCallback } from "react";

function SearchComponent() {
  const [results, setResults] = useState([]);

  const handleSearch = useCallback(
    debounce(async (query: string) => {
      const data = await fetch(`/api/search?q=${query}`);
      setResults(await data.json());
    }, 300),
    []
  );

  return (
    <input
      type="text"
      onChange={(e) => handleSearch(e.target.value)}
      placeholder="Search..."
    />
  );
}
```

### Throttled Event Handler

```typescript
import { throttle } from "@charivo/shared";

const handleResize = throttle(() => {
  console.log("Window size:", window.innerWidth);
}, 200);

window.addEventListener("resize", handleResize);
```

### Message ID Generation

```typescript
import { generateId } from "@charivo/shared";

const message = {
  id: generateId(),
  content: "Hello!",
  timestamp: new Date(),
  type: "user"
};
```

## Performance Tips

### Debounce vs Throttle

**Use Debounce when:**
- Waiting for user to finish typing (search, autocomplete)
- Window resize handlers (when you only care about final size)
- Form validation (validate after user stops typing)

**Use Throttle when:**
- Scroll events (update UI at regular intervals)
- Mouse move tracking (limit position updates)
- Button spam prevention (limit clicks per second)

### Example: Smart Combination

```typescript
import { debounce, throttle } from "@charivo/shared";

// Throttle for immediate feedback
const quickUpdate = throttle((value) => {
  updatePreview(value);
}, 100);

// Debounce for expensive operations
const saveChanges = debounce((value) => {
  saveToDatabase(value);
}, 1000);

input.addEventListener("input", (e) => {
  quickUpdate(e.target.value);  // Update preview quickly
  saveChanges(e.target.value);  // Save after user stops typing
});
```

## License

MIT
