variable "aws_region" {
  description = "Região AWS"
  type        = string
  default     = "us-east-2"
}

variable "instance_type" {
  description = "Tipo da EC2"
  type        = string
  default     = "t3.small"
}

variable "instance_ami" {
  description = "AMI ID (Amazon Linux 2023 us-east-2)"
  type        = string
  default     = "ami-078f95be0757084a3"
}

variable "ssh_key_name" {
  description = "Nome do key pair EC2"
  type        = string
  default     = "access-key-crea-erp"
}

variable "allowed_ssh_cidr" {
  description = "CIDR permitido para SSH"
  type        = string
  default     = "0.0.0.0/0"
}

variable "domain_name" {
  description = "Domínio para o dashboard"
  type        = string
  default     = "luma.theralabs.com.br"
}

variable "github_repo" {
  description = "Repositório GitHub no formato owner/repo"
  type        = string
  default     = "murillous/LumaBot"
}

variable "environment" {
  description = "Ambiente (dev/prod)"
  type        = string
  default     = "production"
}

# ─── Variáveis sensíveis (passadas via -var ou terraform.tfvars) ──────────────

variable "ai_provider" {
  description = "Provider de IA (gemini/openai/deepseek)"
  type        = string
  default     = "gemini"
}

variable "gemini_api_key" {
  description = "API key Gemini"
  type        = string
  sensitive   = true
  default     = ""
}

variable "openai_api_key" {
  description = "API key OpenAI"
  type        = string
  sensitive   = true
  default     = ""
}

variable "deepseek_api_key" {
  description = "API key DeepSeek"
  type        = string
  sensitive   = true
  default     = ""
}

variable "tavily_api_key" {
  description = "API key Tavily (web search)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "owner_number" {
  description = "Número do dono do bot"
  type        = string
  default     = ""
}

variable "log_level" {
  description = "Nível de log"
  type        = string
  default     = "info"
}

variable "dashboard_password" {
  description = "Senha do dashboard"
  type        = string
  sensitive   = true
  default     = ""
}

variable "cloudflare_api_token" {
  description = "API token Cloudflare (DDNS)"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Zone ID do domínio na Cloudflare"
  type        = string
}
