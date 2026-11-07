import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MemoryPanel from './MemoryPanel'
import { setLocale } from './i18n'
const memories=[{id:'one',characterId:'lu' as const,text:'喜欢蓝色',category:'profile' as const,confirmedAt:'2026-11-01T10:00:00Z'}, {id:'two',characterId:'lu' as const,text:'周末一起散步',category:'relationship' as const,state:'archived' as const,confirmedAt:'2026-11-02T10:00:00Z'}, {id:'three',characterId:'lu' as const,text:'最近在准备考试',category:'context' as const,confirmedAt:'2026-11-03T10:00:00Z'}]
const setup=()=>render(<MemoryPanel selected="lu" memories={memories} onSave={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()}/>)
beforeEach(()=>setLocale('zh-CN'));afterEach(()=>{cleanup();setLocale('zh-CN')})
it('puts search above the compact filter chips without the outer glass card',()=>{
 const {container}=setup();const bar=container.querySelector('.memory-filter-bar')!;expect(bar).not.toHaveClass('glass');expect(bar.querySelector('.memory-filters')).toBeNull();expect(bar.querySelector('input')!.compareDocumentPosition(bar.querySelector('select')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.getByPlaceholderText('搜索回忆…')).toBeInTheDocument()
})
it('combines category/status filters and marks only active chips',()=>{
 const {container}=setup();fireEvent.change(screen.getByLabelText('记忆分类筛选'),{target:{value:'profile'}});expect(screen.getByText('喜欢蓝色')).toBeInTheDocument();expect(screen.queryByText('周末一起散步')).toBeNull();expect(container.querySelectorAll('.memory-filter-chip[data-active=true]')).toHaveLength(1);fireEvent.change(screen.getByLabelText('记忆状态筛选'),{target:{value:'archived'}});expect(container.querySelectorAll('.managed-memory')).toHaveLength(0);expect(container.querySelectorAll('.memory-filter-chip[data-active=true]')).toHaveLength(2)
})
it('searches and clears without changing category or status selections',()=>{
 const {container}=setup();fireEvent.change(screen.getByLabelText('搜索记忆'),{target:{value:'蓝色'}});expect(container.querySelectorAll('.managed-memory')).toHaveLength(1);const input=screen.getByLabelText('搜索记忆');input.focus();fireEvent.keyDown(input,{key:'Enter'});expect(input).not.toHaveFocus();fireEvent.click(screen.getByRole('button',{name:'清空搜索'}));expect(container.querySelectorAll('.managed-memory')).toHaveLength(3);expect(screen.getByLabelText('记忆分类筛选')).toHaveValue('all');expect(screen.getByLabelText('记忆状态筛选')).toHaveValue('all')
})
it('updates search hints and clearing control when the language changes',()=>{
 setup();fireEvent.change(screen.getByLabelText('搜索记忆'),{target:{value:'蓝色'}});act(()=>setLocale('en'));expect(screen.getByPlaceholderText('Search memories…')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Clear search'})).toBeInTheDocument()
})
