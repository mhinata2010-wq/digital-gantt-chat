# Operational UI Product Direction

## Purpose

This document defines the product and UX direction for evolving `digital-gantt-chat` from a feature-centered schedule editor into an operational UI for construction site supervision.

The target is not to remove scheduling functionality. The target is to make schedules, dependencies, progress, photos, inspections, orders, and history support one operational flow:

**STATUS -> DELTA -> IMPACT -> ACTION**

## Product principle

The primary user should not need to understand the information architecture of the application before acting.

Instead of asking users to choose between Gantt, network schedule, task list, history, or edit screens, the application should first answer four questions:

1. What is happening on site now?
2. What differs from the plan?
3. What will be affected?
4. What should be done next?

Gantt charts, network diagrams, CPM values, history, and detailed task editing remain available as deeper operational tools rather than the first layer of navigation.

## Primary user

Initial ICP:

- Regional construction companies and contractors
- Roughly 5-30 employees
- One to several site supervisors
- Existing operations rely on combinations of Excel, paper, phone calls, messaging apps, and verbal coordination
- Mobile usage is more important than desktop-only optimization

## Core UX model

### 1. STATUS

Show the site state first.

Examples:

- Work scheduled today
- Work in progress
- Delayed work
- Inspection pending
- Delivery pending
- Approval pending
- Unresolved issues

The first screen should prioritize exceptions and decisions instead of presenting every available feature.

### 2. DELTA

Make the difference between plan and reality explicit.

Examples:

- Planned progress: 100%
- Actual progress: 72%
- Difference: -28%
- Planned completion: Oct 29
- Forecast completion: Oct 31

Users should not need to compare multiple views manually to identify a deviation.

### 3. IMPACT

Use dependency and schedule data to show what may be affected by a deviation.

Examples:

- Formwork start may move by two days
- Concrete booking requires confirmation
- Scaffolding removal may be delayed
- Critical path task affected

Impact calculation is decision support. The system must not silently change confirmed schedules.

### 4. ACTION

Convert detected conditions into clear next actions.

Examples:

- Confirm with subcontractor
- Review proposed schedule change
- Move work to tomorrow
- Request inspection
- Confirm material delivery
- Notify affected members

Actions should be concrete and operational, not generic AI chat suggestions.

## Human-in-the-loop rule

The application may calculate, recommend, or prepare changes, but schedule-impacting decisions must remain reviewable by a responsible person.

Preferred flow:

1. Field update is recorded.
2. System detects a delta.
3. System calculates possible impact.
4. System proposes one or more actions or schedule changes.
5. Supervisor reviews the proposal.
6. Confirmed changes are written to the shared schedule and history.

This is a decision-support product, not an autonomous schedule controller.

## Information architecture

The main navigation should gradually move away from feature-first navigation.

Recommended top-level structure:

### Site

Operational overview for the selected project.

- Current state
- Today
- Progress
- Key schedule indicators

### Attention

Only items requiring judgment or action.

- Delays
- Pending approvals
- Inspections
- Orders and deliveries
- Conflicts
- Proposed schedule changes

### Today

Mobile-first execution view.

- Today's tasks
- Start / progress / complete
- Photo report
- Delay reason
- Short comment

### Schedule

Detailed planning tools.

- Gantt
- Network schedule
- Task list
- Dependencies
- Critical path
- Schedule versions

Advanced schedule data should be disclosed progressively instead of shown by default.

## Progressive disclosure

Do not expose every scheduling metric at the first layer.

Example:

Level 1:

`2 days delayed`

Level 2:

- affected task
- reason
- impacted successors

Level 3:

- dependency graph
- critical path
- EST / EFT / LST / LFT
- TF / FF

This preserves the power of the existing scheduling engine while reducing cognitive load.

## Mobile interaction principles

The field UI should assume:

- one-handed use
- short interaction sessions
- outdoor visibility
- interruptions
- users moving between locations
- users who do not want to learn software terminology

Priorities:

1. Large touch targets
2. Clear status language
3. One primary action per card
4. Minimal modal depth
5. Avoid duplicate editing entry points
6. Keep critical actions reachable without horizontal navigation
7. Preserve context after returning from camera or attachment workflows

## What should remain under the hood

The following capabilities remain valuable and should not be removed simply to simplify the UI:

- Gantt scheduling
- Network schedule
- Dependency relationships
- CPM calculations
- Version comparison
- Change history
- Realtime collaboration
- Offline queue
- Role-based permissions
- Import and export

The UX should decide when these capabilities are surfaced.

## AI policy

AI should primarily reduce input and interpretation work rather than become the main interface.

Good uses:

- Structure free-form field reports
- Classify delay reasons
- Extract tasks and dates from documents
- Summarize change history
- Prepare suggested actions

Avoid making a generic AI chat box the primary interaction model.

## Success metrics

Do not optimize only for number of schedule edits.

Primary product metrics should test whether coordination work is reduced.

Candidate KPIs:

- Time from issue detection to decision
- Time from field report to affected-member notification
- Number of unresolved attention items
- Number of missed dependency impacts
- Time required to perform a schedule change
- Percentage of daily field reports completed on mobile
- Reduction in duplicated entry across schedule, messaging, and reports

## MVP scope for this branch direction

The first operational UI iteration should focus on the existing data model and avoid a full platform rewrite.

Recommended first implementation:

1. Site status summary
2. Attention queue
3. Delta display for delayed tasks
4. Successor impact display using existing dependency data
5. Clear action entry points
6. Today view optimized for mobile
7. Existing Gantt and network views retained under Schedule

## Non-goals

For the first iteration, do not attempt to become a complete construction ERP.

Do not prioritize adding:

- Accounting platform replacement
- Full procurement system
- Generic AI assistant
- CRM
- Broad document management unrelated to the operational flow

Any new feature should justify how it improves STATUS, DELTA, IMPACT, or ACTION.

## Design reference principle

Grafana's `loki-operational-ui` is a useful reference for operational information architecture: surface system state, exceptions, drill-down detail, and administrative actions in one operational context.

Do not copy Grafana's visual design directly. Grafana is optimized for technical desktop operators and high information density. This product must adapt the same operational principle to construction sites, mobile devices, and non-technical field users.

## Review checklist

Before merging future UI work, verify:

- Does the first screen show site state rather than a feature menu?
- Can a supervisor identify urgent items within a few seconds?
- Is the difference between plan and reality visible?
- Are downstream impacts understandable without opening the network view?
- Is the next action clear?
- Are advanced scheduling details still accessible?
- Is there only one obvious path for the same user action?
- Does the mobile interaction work without precision tapping?
- Are schedule-changing recommendations explicitly reviewed by a human?
