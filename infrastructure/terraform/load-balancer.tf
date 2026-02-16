# Global external HTTPS load balancer for Cloud Run via Serverless NEG

resource "google_compute_global_address" "cloud_run_lb_ip" {
  name = var.cloud_run_lb_ip_name
}

resource "google_compute_managed_ssl_certificate" "cloud_run" {
  name = var.cloud_run_managed_cert_name

  managed {
    domains = var.cloud_run_lb_domains
  }
}

resource "google_compute_region_network_endpoint_group" "cloud_run" {
  name                  = var.cloud_run_neg_name
  network_endpoint_type = "SERVERLESS"
  region                = var.cloud_run_region

  cloud_run {
    service = var.cloud_run_service_name
  }
}

resource "google_compute_backend_service" "cloud_run" {
  name                  = var.cloud_run_backend_service_name
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.cloud_run.id

  backend {
    group = google_compute_region_network_endpoint_group.cloud_run.id
  }
}

resource "google_compute_url_map" "cloud_run" {
  name            = var.cloud_run_url_map_name
  default_service = google_compute_backend_service.cloud_run.id
}

resource "google_compute_target_https_proxy" "cloud_run" {
  name             = var.cloud_run_https_proxy_name
  url_map          = google_compute_url_map.cloud_run.id
  ssl_certificates = [google_compute_managed_ssl_certificate.cloud_run.id]
}

resource "google_compute_global_forwarding_rule" "cloud_run_https" {
  name                  = var.cloud_run_https_forwarding_rule_name
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_protocol           = "TCP"
  port_range            = "443"
  ip_address            = google_compute_global_address.cloud_run_lb_ip.id
  target                = google_compute_target_https_proxy.cloud_run.id
}
