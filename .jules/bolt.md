## 2024-05-23 - Performance Optimization

**Learning:** This application uses a single large file `index.tsx` containing multiple components and the main `App` component. All state is centralized in `App`, causing re-renders of the entire tree on every state change (e.g., typing in the input field). The `ChatMessage` component renders markdown, which is expensive.
**Action:** Implementing `React.memo` on `ChatMessage` and `useCallback` on `handleSendMessage` significantly reduces re-renders during typing and streaming. Moving `generateSceneImage` outside of the component helps keep the `useCallback` dependency array clean.
