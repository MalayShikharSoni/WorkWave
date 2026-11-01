import React, { useState, useEffect, useCallback } from "react";
import { invitationAPI } from "../../services/api";
import type { TeamMember, PendingInvitation } from "../../types";
import AvatarUpload from "../AvatarUpload/AvatarUpload";
import styles from "./TeamManagement.module.css";

const TeamManagement: React.FC = () => {
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
    const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
    const [inviteEmail, setInviteEmail] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState("");
    const [successMsg, setSuccessMsg] = useState("");

    const fetchData = useCallback(async () => {
        try {
            setIsLoading(true);
            const [teamRes, pendingRes] = await Promise.all([
                invitationAPI.getTeamMembers(), invitationAPI.getPendingInvitations(),
            ]);
            setTeamMembers(teamRes.data.data); setPendingInvitations(pendingRes.data.data);
        } catch (err) { console.error("Failed to fetch team data:", err); setError("Failed to load team data."); }
        finally { setIsLoading(false); }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSendInvitation = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const email = inviteEmail.trim();
        if (!email) return;
        setIsSending(true); setError(""); setSuccessMsg("");
        try {
            const res = await invitationAPI.sendInvitation(email);
            setSuccessMsg(res.data.message || "Invitation sent!"); setInviteEmail(""); await fetchData();
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } } };
            setError(e.response?.data?.error || "Failed to send invitation");
        } finally { setIsSending(false); setTimeout(() => setSuccessMsg(""), 3000); setTimeout(() => setError(""), 5000); }
    };

    if (isLoading) {
        return (<div className={styles.loadingContainer}><div className={styles.loadingContent}>
            <div className={styles.spinner}></div>
            <p className={styles.loadingText}>Loading team data...</p></div></div>);
    }

    return (
        <div className={styles.container}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                <div className={styles.title} style={{ marginBottom: 0 }}>Your Team</div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button 
                    onClick={() => window.location.href = '/groups'}
                    style={{ 
                      background: '#8b6c3e', 
                      color: '#fff', 
                      border: 'none', 
                      padding: '12px 24px', 
                      borderRadius: '12px', 
                      fontWeight: 900, 
                      fontSize: '1.1rem', 
                      cursor: 'pointer', 
                      boxShadow: '0 4px 15px rgba(139, 108, 62, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'transform 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                    Project Groups
                  </button>
                  <button 
                    onClick={() => window.location.href = '/leaderboard'}
                    style={{ 
                      background: '#f4a261', 
                      color: '#fff', 
                      border: 'none', 
                      padding: '12px 24px', 
                      borderRadius: '12px', 
                      fontWeight: 900, 
                      fontSize: '1.1rem', 
                      cursor: 'pointer', 
                      boxShadow: '0 4px 15px rgba(244, 162, 97, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'transform 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    EOM Leaderboard
                  </button>
                  <button 
                    onClick={() => window.location.href = '/analytics'}
                    style={{ 
                      background: '#2a9d8f', 
                      color: '#fff', 
                      border: 'none', 
                      padding: '12px 24px', 
                      borderRadius: '12px', 
                      fontWeight: 900, 
                      fontSize: '1.1rem', 
                      cursor: 'pointer', 
                      boxShadow: '0 4px 15px rgba(42, 157, 143, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'transform 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                    Analytics
                  </button>
                </div>
            </div>
            <div className={styles.content}>
                {error && (<div className={styles.errorMsg}>{error}</div>)}
                {successMsg && (<div className={styles.successMsg}>{successMsg}</div>)}
                <div className={styles.inviteBox}>
                    <div className={styles.inviteTitle}>Invite an Employee</div>
                    <form onSubmit={handleSendInvitation} className={styles.inviteContent}>
                        <div className={styles.selectedRow}>
                            <div className={`${styles.searchWrap} ${styles.inviteInputWrap}`}>
                                <svg className={styles.searchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9c815a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
                                </svg>
                                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                                    placeholder="Employee's email address" disabled={isSending} required
                                    aria-label="Employee email address" autoComplete="off"
                                    className={styles.searchInput} />
                            </div>
                            <button type="submit" disabled={isSending || !inviteEmail.trim()} className={styles.sendBtn}>
                                {isSending ? "Sending..." : "Send Invite"}
                            </button>
                        </div>
                        <p className={styles.noEmployees}>Enter the exact email the employee signed up with.</p>
                    </form>
                </div>
                {pendingInvitations.length > 0 && (
                    <div className={styles.pendingSection}>
                        <div className={styles.sectionTitle}>Pending Invitations</div>
                        <div className={styles.pendingList}>
                            {pendingInvitations.map((inv) => (
                                <div key={inv.id} className={styles.pendingCard}>
                                    <div className={styles.pendingInfo}>
                                        <span className={styles.pendingName}>{inv.first_name}</span>
                                        <span className={styles.pendingEmail}>{inv.email}</span>
                                    </div>
                                    <span className={styles.pendingBadge}>⏳ Pending</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className={styles.teamSection}>
                    <div className={styles.sectionTitle}>Team Members ({teamMembers.length})</div>
                    {teamMembers.length === 0 ? (
                        <div className={styles.emptyTeam}>
                            <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.emptyTeamIcon}>
                                <circle cx="60" cy="60" r="56" stroke="#ad9676" strokeWidth="2.5" strokeDasharray="8 6" opacity="0.5" />
                                <circle cx="60" cy="44" r="14" fill="#ad9676" opacity="0.7" />
                                <path d="M36 82c0-13.255 10.745-24 24-24s24 10.745 24 24" stroke="#ad9676" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.5" />
                                <circle cx="32" cy="54" r="8" fill="#9c815a" opacity="0.4" />
                                <path d="M20 72c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="#9c815a" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.3" />
                                <circle cx="88" cy="54" r="8" fill="#9c815a" opacity="0.4" />
                                <path d="M76 72c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="#9c815a" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.3" />
                                <line x1="60" y1="90" x2="60" y2="106" stroke="#8b6c3e" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
                                <line x1="52" y1="98" x2="68" y2="98" stroke="#8b6c3e" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
                            </svg>
                            <p className={styles.emptyTeamText}>No team members yet. Send invitations to employees to build your team!</p>
                        </div>
                    ) : (
                        <div className={styles.memberList}>
                            {teamMembers.map((member) => (
                                <div 
                                    key={member.id} 
                                    className={styles.memberCard}
                                    onClick={() => window.location.href = `/employees/${member.id}`}
                                    style={{ cursor: 'pointer', transition: 'transform 0.2s', ...{ ':hover': { transform: 'translateY(-2px)' } } as any }}
                                    title="View Profile"
                                >
                                    <div className={styles.memberInfo}>
                                        <div className={styles.avatar} style={{ marginRight: '10px' }}>
                                            <AvatarUpload currentAvatarUrl={member.avatar_url} name={member.first_name || ''} size={40} readOnly />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span className={styles.memberName}>{member.first_name}</span>
                                            <span className={styles.memberEmail}>{member.email}</span>
                                            {member.designation && <span style={{ fontSize: '0.8rem', color: '#666' }}>{member.designation}</span>}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                      <span style={{ fontSize: '0.8rem', color: '#3b3123', fontWeight: 'bold', textDecoration: 'underline' }}>View Profile</span>
                                      <span className={styles.activeBadge}>✓ Active</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TeamManagement;
