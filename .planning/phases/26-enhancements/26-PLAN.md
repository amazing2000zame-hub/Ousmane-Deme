# Phase 26: Enhancements - Latency Logging, Visual Upgrade, Extended Access

**Goals:**
1. Add voice latency logging and metrics display
2. Redesign start screen with cooler graphics
3. Extend Jarvis server access with keyword-based approval

---

## Task 1: Voice Latency Logging System

**Backend:** Already tracks timing via RequestTimer (Phase 24)
**Frontend:** Need to capture and display metrics

**Implementation:**
- Add chat:timing listener in useChatSocket
- Create LatencyMetrics component to display timing breakdown
- Add toggle to show/hide metrics panel
- Store last N timing entries for analysis

**Files:**
- jarvis-ui/src/hooks/useChatSocket.ts - add timing listener
- jarvis-ui/src/stores/metrics.ts (NEW) - metrics store
- jarvis-ui/src/components/LatencyMetrics.tsx (NEW) - display component

---

## Task 2: Enhanced Start Screen Graphics

**Current:** Simple text "Ready to assist, sir."
**Target:** Animated HUD with scan lines, glowing elements, JARVIS branding

**Features:**
- Animated circular HUD rings
- Pulsing glow effects
- Scan line animations
- JARVIS logo/icon in center
- Status indicators (systems online, voice ready, etc.)

**Files:**
- jarvis-ui/src/components/center/StartScreen.tsx (NEW)
- jarvis-ui/src/components/center/ChatPanel.tsx - use StartScreen component

---

## Task 3: Extended Server Access with Keyword Approval

**New Tools (all require keyword approval):**
- delete_file - delete files/directories
- execute_command - run arbitrary shell commands  
- install_package - apt install packages
- manage_service - systemctl operations
- reboot_node - reboot cluster nodes

**Keyword Approval System:**
- New ORANGE tier: requires keyword confirmation
- User must type approval keyword in response
- Backend validates keyword before executing
- Configurable keyword in .env (default: "JARVIS-EXECUTE")

**Safety:**
- File deletion: ORANGE tier (keyword required)
- System commands: ORANGE tier
- Node reboot: Changed from BLACK to ORANGE
- Protected resources still blocked (no keyword bypass)

**Files:**
- jarvis-backend/src/safety/tiers.ts - add ORANGE tier
- jarvis-backend/src/safety/keyword-approval.ts (NEW) - keyword validation
- jarvis-backend/src/mcp/tools/system.ts (NEW) - new system tools
- jarvis-backend/src/config.ts - add APPROVAL_KEYWORD config

---

## Task 4: TTS Piper Fallback with Pre-cached Jarvis Phrases

**Problem:** When XTTS is slow (>15s), Piper fallback speaks with a generic voice that doesn't sound like Jarvis. Two voices playing is jarring.

**Current State:** Piper disabled (PIPER_TTS_ENDPOINT=) in .env as of 2026-01-30

**Solution:** Pre-synthesize acknowledgment phrases with XTTS Jarvis voice, so Piper fallback can use cached Jarvis audio instead of generating with its own voice.

**Acknowledgment Phrases to Pre-cache:**
- "One moment, sir."
- "Working on it."
- "Right away, sir."
- "Let me check on that."
- "Getting that pulled up now."

**Implementation:**
1. On backend startup, pre-warm these phrases via XTTS (already have prewarmTtsCache)
2. Store in disk cache (already implemented in tts-cache.ts)
3. Modify Piper fallback path to check for cached Jarvis audio first
4. Only use Piper voice as last resort (no cache, XTTS down)

**Files:**
- jarvis-backend/src/ai/tts.ts - synthesizeViaPiper() to check XTTS disk cache first
- jarvis-backend/src/ai/tts.ts - extend PREWARM_PHRASES list if needed
- jarvis-backend/.env - re-enable PIPER_TTS_ENDPOINT once implemented

**Acceptance Criteria:**
- Acknowledgments always use Jarvis voice (from cache)
- Only fall back to Piper voice for novel phrases when XTTS times out

---

**Estimated Time:** 4-5 hours
**Risk:** Low - all isolated features, no breaking changes
