"""Organisation and identity: branches, departments, teams, employees and the CRM login accounts (users)."""
from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, BranchedMixin, JsonType, RecordMixin, TimestampMixin, UTCDateTime, utcnow

ACCESS_LEVELS = ("Super Admin", "Admin", "Employee")
USER_STATUSES = ("Active", "Pending", "Suspended", "Locked", "Inactive")
EMPLOYEE_STATUSES = ("Active", "Probation", "On Leave", "Remote", "Suspended", "Resigned", "Terminated", "Inactive")
BRANCH_STATUSES = ("Active", "Inactive")


class Branch(TimestampMixin, Base):
    __tablename__ = "branches"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(10), default="Active", nullable=False)
    __table_args__ = (CheckConstraint("status in ('Active','Inactive')", name="status"),)


class Department(RecordMixin, Base):
    """Organisation-wide structure (shared by every branch)."""

    __tablename__ = "departments"
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    description: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    head_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("employees.id", ondelete="SET NULL", use_alter=True, name="fk_departments_head_id_employees"), nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="Active", nullable=False)
    __table_args__ = (CheckConstraint("status in ('Active','Inactive')", name="status"),)


class Team(RecordMixin, BranchedMixin, Base):
    """A team belongs to ONE branch: its name, leader and members are that branch's business."""

    __tablename__ = "teams"
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    department_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("departments.id", ondelete="RESTRICT"), nullable=True, index=True)
    parent_team_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    leader_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("employees.id", ondelete="SET NULL", use_alter=True, name="fk_teams_leader_id_employees"), nullable=True)
    deputy_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("employees.id", ondelete="SET NULL", use_alter=True, name="fk_teams_deputy_id_employees"), nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="Active", nullable=False)
    __table_args__ = (CheckConstraint("status in ('Active','Inactive')", name="status"),)


class Employee(RecordMixin, BranchedMixin, Base):
    """The employee master. One row per person; a CRM login (users) is optional but every login has an employee."""

    __tablename__ = "employees"
    BRANCH_OPTIONAL = True  # the all-branch Super Admin belongs to no single branch
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    official_email: Mapped[str] = mapped_column(String(254), nullable=False)
    mobile: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    alt_phone: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    designation: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    job_title: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    gender: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    personal_email: Mapped[str] = mapped_column(String(254), default="", nullable=False)
    address: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    join_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    exit_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    employment_type: Mapped[str] = mapped_column(String(30), default="Full-time", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Active", nullable=False, index=True)
    work_location: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    shift: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    work_mode: Mapped[str] = mapped_column(String(20), default="On-site", nullable=False)
    department_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("departments.id", ondelete="RESTRICT", use_alter=True, name="fk_employees_department_id_departments"), nullable=True, index=True)
    team_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("teams.id", ondelete="SET NULL", use_alter=True, name="fk_employees_team_id_teams"), nullable=True, index=True)
    sub_team_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("teams.id", ondelete="SET NULL", use_alter=True, name="fk_employees_sub_team_id_teams"), nullable=True)
    reports_to: Mapped[str | None] = mapped_column(String(40), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    __table_args__ = (
        CheckConstraint("status in ('Active','Probation','On Leave','Remote','Suspended','Resigned','Terminated','Inactive')", name="status"),
        Index("uq_employees_official_email_lower", func.lower(official_email), unique=True),
    )


class User(TimestampMixin, Base):
    """A CRM login. Its role (access level), branch and module permissions are set only by the Super Admin and are the sole source of authorisation."""

    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    employee_id: Mapped[str] = mapped_column(String(40), ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False, unique=True)
    first_name: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    last_name: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    username: Mapped[str] = mapped_column(String(80), nullable=False)
    phone: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    department: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    access_level: Mapped[str] = mapped_column(String(12), nullable=False)  # Super Admin | Admin | Employee
    job_role: Mapped[str] = mapped_column(String(60), default="Employee", nullable=False)  # the job profile permissions start from (Sales Executive, Accounts, ...)
    branch: Mapped[str | None] = mapped_column(String(40), ForeignKey("branches.name", onupdate="CASCADE", ondelete="RESTRICT"), nullable=True, index=True)
    branch_access: Mapped[str | None] = mapped_column(String(3), nullable=True)  # 'all' only on a Super Admin: explicit authorisation to see every branch
    permissions: Mapped[dict | None] = mapped_column(JsonType, nullable=True)  # { "Leads": {view,create,edit,delete,export}, ... } - null = the job profile's defaults
    status: Mapped[str] = mapped_column(String(12), default="Active", nullable=False, index=True)
    previous_status: Mapped[str | None] = mapped_column(String(12), nullable=True)
    force_password_change: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    last_login_ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    password_changed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    password_changed_by: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    initials: Mapped[str] = mapped_column(String(4), default="", nullable=False)
    avatar_color: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)

    employee: Mapped[Employee] = relationship(lazy="joined")

    __table_args__ = (
        CheckConstraint("access_level in ('Super Admin','Admin','Employee')", name="access_level"),
        CheckConstraint("status in ('Active','Pending','Suspended','Locked','Inactive')", name="status"),
        CheckConstraint("branch_access is null or branch_access = 'all'", name="branch_access"),
        # only a Super Admin may hold all-branch access; everyone else must belong to exactly one branch
        CheckConstraint("(access_level = 'Super Admin' and branch_access = 'all' and branch is null) or (access_level <> 'Super Admin' and branch_access is null and branch is not null)", name="branch_assignment"),
        Index("uq_users_email_lower", func.lower(email), unique=True),
        Index("uq_users_username_lower", func.lower(username), unique=True),
    )


class AuthSession(Base):
    """A signed-in session. Access tokens carry its id; revoking the row (logout, password change, deactivation, admin termination) kills every token issued for it."""

    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(40), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    refresh_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)  # only a hash of the opaque refresh token is stored; it rotates on every use
    prev_refresh_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)  # presenting an already-rotated token means it leaked: the session is revoked
    device: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    user_agent: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)  # the last request of any kind (background refreshes included)
    last_activity_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)  # the last time the PERSON did something (sign-in, or a heartbeat sent while they use the app)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)


class PasswordReset(Base):
    __tablename__ = "password_resets"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(40), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
