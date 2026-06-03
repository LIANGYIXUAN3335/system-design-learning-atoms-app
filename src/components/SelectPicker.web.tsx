import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';

/**
 * 一个下拉筛选器。
 *
 * web 实现：真的 DOM `<select>`。内容和 SelectPicker.tsx 相同 —— 基文件按 MermaidView 的惯例
 * 保持 web-safe，这一份是给 Metro 明确选中的 web 分身。iOS/Android 走 SelectPicker.native.tsx。
 *
 * 为什么在 web 上非用原生 select 不可：29 家公司用「点开→一片胶囊」要两次点击，而且展开的那一片
 * 会把下面整个库往下推一屏。原生 select 是一次点击、浮层覆盖、不动布局。
 */

export interface SelectPickerProps {
  label: string;
  value: string;
  options: string[];
  /** 空值那一项显示什么，比如「全部公司」 */
  allLabel: string;
  onChange: (value: string) => void;
}

export function SelectPicker({ label, value, options, allLabel, onChange }: SelectPickerProps) {
  const { colors } = useTheme();
  return (
    <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 150 }}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          font: 'inherit',
          fontSize: 14,
          padding: '8px 11px',
          borderRadius: 8,
          border: `1px solid ${colors.line}`,
          background: colors.card,
          color: value ? colors.ink : colors.muted,
        }}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </View>
  );
}
