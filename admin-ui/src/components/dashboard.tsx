import { useState } from 'react'
import { RefreshCw, LogOut, Moon, Sun, Server, Plus, ShieldCheck, Activity, ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { storage } from '@/lib/storage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CredentialCard } from '@/components/credential-card'
import { BalanceDialog } from '@/components/balance-dialog'
import { AddCredentialDialog } from '@/components/add-credential-dialog'
import { Switch } from '@/components/ui/switch'
import { ValidateCredentialsDialog } from '@/components/validate-credentials-dialog'
import { useCredentials, useCredentialStrategy, useSetCredentialStrategy, useUsageStats } from '@/hooks/use-credentials'
import type { UsageStatsRange } from '@/types/api'



interface DashboardProps {
  onLogout: () => void
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [selectedCredentialId, setSelectedCredentialId] = useState<number | null>(null)
  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [validateDialogOpen, setValidateDialogOpen] = useState(false)
  const [usageRange, setUsageRange] = useState<UsageStatsRange>('24h')
  const [darkMode, setDarkMode] = useState(() => {

    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark')
    }
    return false
  })

  const queryClient = useQueryClient()
  const { data, isLoading, error, refetch } = useCredentials()
  const { data: strategyData } = useCredentialStrategy()
  const setStrategyMutation = useSetCredentialStrategy()
  const { data: usageData, isLoading: usageLoading, error: usageError } = useUsageStats(usageRange)

  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
    document.documentElement.classList.toggle('dark')
  }

  const handleViewBalance = (id: number) => {
    setSelectedCredentialId(id)
    setBalanceDialogOpen(true)
  }

  const handleRefresh = () => {
    refetch()
    toast.success('已刷新凭据列表')
  }

  const handleStrategyToggle = (checked: boolean) => {
    const newStrategy = checked ? 'roundRobin' : 'priority'
    setStrategyMutation.mutate(newStrategy, {
      onSuccess: () => {
        toast.success(`已切换为${checked ? '轮询' : '优先级'}模式`)
      },
      onError: (err) => {
        toast.error(`切换失败: ${(err as Error).message}`)
      },
    })
  }

  const handleLogout = () => {
    storage.removeApiKey()
    queryClient.clear()
    onLogout()
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="text-red-500 mb-4">加载失败</div>
            <p className="text-muted-foreground mb-4">{(error as Error).message}</p>
            <div className="space-x-2">
              <Button onClick={() => refetch()}>重试</Button>
              <Button variant="outline" onClick={handleLogout}>重新登录</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <span className="font-semibold">Kiro Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleDarkMode}>
              {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleRefresh}>
              <RefreshCw className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="container px-4 md:px-8 py-6">
        {/* 统计卡片 */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                凭据总数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                可用凭据
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{data?.available || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                当前活跃
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center gap-2">
                #{data?.currentId || '-'}
                <Badge variant="success">活跃</Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                凭据策略
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {strategyData?.credentialStrategy === 'roundRobin' ? '轮询' : '优先级'}
                </span>
                <Switch
                  checked={strategyData?.credentialStrategy === 'roundRobin'}
                  onCheckedChange={handleStrategyToggle}
                  disabled={setStrategyMutation.isPending}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 使用统计 */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Activity className="h-4 w-4" />
                使用统计
              </CardTitle>
              <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                <Button
                  variant={usageRange === '24h' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setUsageRange('24h')}
                >
                  24小时
                </Button>
                <Button
                  variant={usageRange === '7d' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setUsageRange('7d')}
                >
                  7天
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {usageLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            ) : usageError ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                加载统计数据失败
              </div>
            ) : usageData ? (
              <div className="space-y-4">
                {/* 总计 */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-xs text-muted-foreground mb-1">调用次数</div>
                    <div className="text-xl font-semibold">{usageData.totals.calls.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <ArrowUpRight className="h-3 w-3" />
                      输入 Tokens
                    </div>
                    <div className="text-xl font-semibold">{usageData.totals.inputTokens.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <ArrowDownLeft className="h-3 w-3" />
                      输出 Tokens
                    </div>
                    <div className="text-xl font-semibold">{usageData.totals.outputTokens.toLocaleString()}</div>
                  </div>
                </div>

                {/* 按模型分类 */}
                {usageData.byModel.length > 0 && (
                  <div className="border-t pt-3">
                    <div className="text-xs text-muted-foreground mb-2">按模型分类</div>
                    <div className="space-y-2">
                      {usageData.byModel.map((item) => (
                        <div
                          key={item.model}
                          className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-muted/50 transition-colors"
                        >
                          <span className="font-medium">{item.model}</span>
                          <div className="flex items-center gap-4 text-muted-foreground text-xs">
                            <span>{item.calls.toLocaleString()} 次</span>
                            <span className="text-green-600 dark:text-green-400">↑{item.inputTokens.toLocaleString()}</span>
                            <span className="text-blue-600 dark:text-blue-400">↓{item.outputTokens.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground text-sm">
                暂无统计数据
              </div>
            )}
          </CardContent>
        </Card>

        {/* 凭据列表 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">凭据管理</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setValidateDialogOpen(true)} size="sm">
                <ShieldCheck className="h-4 w-4 mr-2" />
                验证凭据
              </Button>
              <Button onClick={() => setAddDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                添加凭据
              </Button>
            </div>
          </div>
          {data?.credentials.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                暂无凭据
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {data?.credentials.map((credential) => (
                <CredentialCard
                  key={credential.id}
                  credential={credential}
                  onViewBalance={handleViewBalance}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* 余额对话框 */}
      <BalanceDialog
        credentialId={selectedCredentialId}
        open={balanceDialogOpen}
        onOpenChange={setBalanceDialogOpen}
      />

      {/* 添加凭据对话框 */}
      <AddCredentialDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />

      {/* 验证凭据对话框 */}
      <ValidateCredentialsDialog
        open={validateDialogOpen}
        onOpenChange={setValidateDialogOpen}
      />
    </div>
  )
}
