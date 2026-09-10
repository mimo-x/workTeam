## ADDED Requirements

### Requirement: Approval events carry governed execution context

Runtime SHALL emit approval requests with enough correlation metadata for the orchestration layer to identify the Task, Task revision, Run, Session, Turn, Agent, and provider request.

#### Scenario: Approval is emitted during a governed run
- **WHEN** a Runtime requires permission while executing a governed TaskRun
- **THEN** the normalized approval event can be correlated to exactly one active Run and permission envelope

### Requirement: Remote approval resolution is resumable

Runtime approval handling SHALL support resolving a still-pending provider request after the Agent Host has relayed a human decision, and SHALL reject stale or mismatched resolutions.

#### Scenario: Matching decision returns
- **WHEN** the Agent Host receives a valid decision for the pending provider request
- **THEN** the Runtime resumes or rejects that request according to the decision without starting a second Turn

#### Scenario: Runtime cannot preserve the pending request
- **WHEN** a Runtime or Host restart makes the provider request impossible to resume
- **THEN** the Run fails safely with a structured non-resumable approval error and is not replayed automatically

