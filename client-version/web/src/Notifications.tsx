import { useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ArrowUpRight, Package, Phone, LifeBuoy, ReceiptText } from 'lucide-react';
import { Context, canVisitPage } from './App';
import { api, post, Row } from './api';
import { Loading, ErrorState } from './components';
import './notifications.css';

const icons: Record<string, typeof Bell> = {Transactions:ReceiptText, Calls:Phone, Stock:Package, Support:LifeBuoy, Workspace:Bell};
export default function Notifications() {
  const {user} = useContext(Context), client=useQueryClient(), navigate=useNavigate();
  const [category,setCategory]=useState('All'), [unread,setUnread]=useState(false), [search,setSearch]=useState('');
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const query=useQuery({queryKey:['notifications',user.id],queryFn:()=>api('/notifications'),enabled:canVisitPage('/notifications',user),refetchInterval:20000});
  const categories:string[]=query.data?.categories || [];
  const items:Row[]=(query.data?.items || []).filter((row:Row)=>categories.includes(row.category) && typeof row.web_path==='string' && row.web_path.startsWith('/') && !row.web_path.startsWith('//') && canVisitPage(row.web_path.split('?')[0],user));
  const visible=items.filter(row=>(category==='All'||row.category===category)&&(!unread||!row.read)&&`${row.title} ${row.message}`.toLowerCase().includes(search.toLowerCase()));
  async function mark(rows:Row[], read=true, path?:string) {
    if(path && (!path.startsWith('/') || path.startsWith('//') || !canVisitPage(path.split('?')[0],user))) {setError('This page is not available for your role');return;}
    setBusy(true);setError('');
    try {await post('/notifications/read',{ids:rows.map(row=>row.id),read});await client.invalidateQueries({queryKey:['notifications']});if(path) navigate(path);}
    catch(e){setError(e instanceof Error?e.message:'Could not update notifications');}finally{setBusy(false);}
  }
  return <section className="notification-center">
    <header className="notification-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>Notifications <span>{query.data?.unread || 0} unread</span></h1></div><button disabled={busy || !visible.some(row=>!row.read)} onClick={()=>mark(visible.filter(row=>!row.read))}><CheckCheck size={17}/>Mark shown as read</button></header>
    <div className="notification-filters" role="group" aria-label="Notification categories">{['All',...categories].map(value=><button key={value} aria-pressed={category===value} onClick={()=>setCategory(value)}>{value}<span>{items.filter(row=>(value==='All'||row.category===value)&&!row.read).length}</span></button>)}</div>
    <div className="notification-tools"><input aria-label="Search notifications" placeholder="Search notifications" value={search} onChange={e=>setSearch(e.target.value)}/><label><input type="checkbox" checked={unread} onChange={e=>setUnread(e.target.checked)}/>Unread only</label></div>
    {error && <p role="alert">{error}</p>}
    {query.isPending ? <Loading/> : query.error ? <ErrorState error={query.error} retry={query.refetch}/> : !visible.length ? <div className="notification-empty"><Bell size={32}/><h2>You’re all caught up</h2><p>No notifications match this view.</p></div> : <div className="notification-list">{visible.map(row=>{const Icon=icons[row.category]||Bell;return <article key={row.id} className={`notification-row ${row.read?'is-read':'is-unread'}`}>
      <button className="notification-open" disabled={busy} onClick={()=>mark([row],true,row.web_path)}><span className={`notification-icon tone-${row.category.toLowerCase()}`}><Icon size={22}/></span><span className="notification-copy"><small>{row.category}{row.attention?' · Needs attention':''}</small><strong>{row.title}</strong><span>{row.message}</span><time>{new Date(row.created_at.endsWith('Z')?row.created_at:row.created_at+'Z').toLocaleString()}</time></span><ArrowUpRight size={18}/></button>
      <button className="notification-read" disabled={busy} onClick={()=>mark([row],!row.read)}>{row.read?'Mark unread':'Mark read'}</button>
    </article>})}</div>}
  </section>;
}
